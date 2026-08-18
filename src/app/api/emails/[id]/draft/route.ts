import { NextResponse } from "next/server";
import { db, EmailRow } from "@/lib/db";
import { guard, failure } from "@/lib/guard";
import { LIMITS } from "@/lib/rateLimit";
import { draftReply } from "@/lib/ai";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, { rule: LIMITS.draft, bucket: "draft" });
  if (!g.ok) return g.response;

  try {
    const email = db
      .prepare("SELECT * FROM emails WHERE id = ? AND user_id = ?")
      .get(id, g.user.id) as EmailRow | undefined;
    if (!email) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const text = await draftReply({
      from: email.from_addr ?? "",
      subject: email.subject ?? "",
      bodyText: email.body_text ?? "",
      category: email.category ?? "Other",
    });

    db.prepare("UPDATE emails SET draft_text = ? WHERE id = ?").run(text, id);

    return NextResponse.json({ draftText: text });
  } catch (err) {
    return failure("emails.draft", err, "draft_failed");
  }
}
