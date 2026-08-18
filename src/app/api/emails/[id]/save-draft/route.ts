import { NextResponse } from "next/server";
import { db, EmailRow } from "@/lib/db";
import { guard, failure } from "@/lib/guard";
import { LIMITS } from "@/lib/rateLimit";
import { createDraft, updateDraft } from "@/lib/gmail";

const MAX_DRAFT_CHARS = 25_000;

function replyAddress(fromHeader: string): string {
  // "Jane Doe <jane@example.com>" -> "jane@example.com"
  const match = fromHeader.match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader).trim();
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, { rule: LIMITS.saveDraft, bucket: "saveDraft" });
  if (!g.ok) return g.response;

  try {
    const email = db
      .prepare("SELECT * FROM emails WHERE id = ? AND user_id = ?")
      .get(id, g.user.id) as EmailRow | undefined;
    if (!email) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const text: string = body?.text ?? email.draft_text ?? "";
    if (!text.trim()) {
      return NextResponse.json({ error: "empty_draft" }, { status: 400 });
    }
    if (text.length > MAX_DRAFT_CHARS) {
      return NextResponse.json({ error: "draft_too_long" }, { status: 400 });
    }

    const to = replyAddress(email.from_addr ?? "");
    if (!to) return NextResponse.json({ error: "no_reply_address" }, { status: 400 });

    const subject = (email.subject ?? "").startsWith("Re:")
      ? email.subject!
      : `Re: ${email.subject ?? ""}`;

    const draftOpts = {
      to,
      subject,
      body: text,
      threadId: email.thread_id,
      inReplyToMessageId: email.message_id ?? undefined,
    };

    let draftId = email.gmail_draft_id ?? undefined;
    if (draftId) {
      await updateDraft(g.auth, draftId, draftOpts);
    } else {
      draftId = await createDraft(g.auth, draftOpts);
    }

    db.prepare("UPDATE emails SET draft_text = ?, gmail_draft_id = ? WHERE id = ?").run(
      text,
      draftId,
      id
    );

    return NextResponse.json({ gmailDraftId: draftId });
  } catch (err) {
    return failure("emails.saveDraft", err, "save_draft_failed");
  }
}
