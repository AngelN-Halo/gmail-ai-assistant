import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard, failure } from "@/lib/guard";
import { LIMITS } from "@/lib/rateLimit";
import { listRecentMessages } from "@/lib/gmail";

export async function POST(req: Request) {
  const g = await guard(req, { rule: LIMITS.sync, bucket: "sync" });
  if (!g.ok) return g.response;

  try {
    const body = await req.json().catch(() => ({}));
    const maxResults = Math.min(Math.max(Number(body?.maxResults) || 20, 1), 50);

    const messages = await listRecentMessages(g.auth, { maxResults });

    const upsert = db.prepare(`
      INSERT INTO emails (
        id, user_id, thread_id, message_id, from_addr, to_addr,
        subject, snippet, body_text, received_at
      )
      VALUES (
        @id, @user_id, @thread_id, @message_id, @from_addr, @to_addr,
        @subject, @snippet, @body_text, @received_at
      )
      ON CONFLICT(id) DO UPDATE SET
        message_id  = excluded.message_id,
        subject     = excluded.subject,
        snippet     = excluded.snippet,
        body_text   = excluded.body_text,
        received_at = excluded.received_at
    `);

    const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) upsert.run(row);
    });

    insertMany(
      messages.map((m) => ({
        id: m.id,
        user_id: g.user.id,
        thread_id: m.threadId,
        message_id: m.messageId || null,
        from_addr: m.from,
        to_addr: m.to,
        subject: m.subject,
        snippet: m.snippet,
        body_text: m.bodyText,
        received_at: m.receivedAt,
      }))
    );

    return NextResponse.json({ synced: messages.length });
  } catch (err) {
    return failure("emails.sync", err, "sync_failed");
  }
}
