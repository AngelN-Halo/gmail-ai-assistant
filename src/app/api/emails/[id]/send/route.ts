import { NextResponse } from "next/server";
import { db, EmailRow } from "@/lib/db";
import { guard, failure } from "@/lib/guard";
import { LIMITS } from "@/lib/rateLimit";
import { sendDraft } from "@/lib/gmail";

// Manual, user-triggered send only. This route is never called automatically by
// anything else in the app: it requires an explicit confirm:true from the UI,
// and only sends a draft that was already saved to Gmail (i.e. reviewed).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, { rule: LIMITS.send, bucket: "send" });
  if (!g.ok) return g.response;

  try {
    const email = db
      .prepare("SELECT * FROM emails WHERE id = ? AND user_id = ?")
      .get(id, g.user.id) as EmailRow | undefined;
    if (!email) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!email.gmail_draft_id) {
      return NextResponse.json({ error: "no_saved_draft" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
    }

    await sendDraft(g.auth, email.gmail_draft_id);
    return NextResponse.json({ sent: true });
  } catch (err) {
    return failure("emails.send", err, "send_failed");
  }
}
