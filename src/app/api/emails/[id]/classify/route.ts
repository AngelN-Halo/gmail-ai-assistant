import { NextResponse } from "next/server";
import { db, EmailRow } from "@/lib/db";
import { guard, failure } from "@/lib/guard";
import { LIMITS } from "@/lib/rateLimit";
import { classifyEmail } from "@/lib/ai";
import { ensureLabel, applyLabel } from "@/lib/gmail";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(req, { rule: LIMITS.classify, bucket: "classify" });
  if (!g.ok) return g.response;

  try {
    const email = db
      .prepare("SELECT * FROM emails WHERE id = ? AND user_id = ?")
      .get(id, g.user.id) as EmailRow | undefined;
    if (!email) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const result = await classifyEmail({
      from: email.from_addr ?? "",
      subject: email.subject ?? "",
      snippet: email.snippet ?? "",
      bodyText: email.body_text ?? "",
    });

    db.prepare(
      "UPDATE emails SET category = ?, priority = ?, ai_reasoning = ? WHERE id = ?"
    ).run(result.category, result.priority, result.reasoning, id);

    // Mirror the category onto Gmail as a label so it's visible/searchable there
    // too. A labelling failure shouldn't discard a good classification.
    let labeled = false;
    try {
      const labelId = await ensureLabel(g.auth, `AI/${result.category}`);
      await applyLabel(g.auth, id, labelId);
      labeled = true;
    } catch (labelErr) {
      console.error("[emails.classify] failed to apply Gmail label", labelErr);
    }
    db.prepare("UPDATE emails SET labeled = ? WHERE id = ?").run(labeled ? 1 : 0, id);

    return NextResponse.json({ ...result, labeled });
  } catch (err) {
    return failure("emails.classify", err, "classify_failed");
  }
}
