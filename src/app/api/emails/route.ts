import { NextResponse } from "next/server";
import { db, EmailRow } from "@/lib/db";
import { guard, failure } from "@/lib/guard";

export async function GET(req: Request) {
  const g = await guard(req);
  if (!g.ok) return g.response;

  try {
    // Ordered by when the mail actually arrived (received_at is an ISO string
    // derived from Gmail's internalDate), not by when we happened to sync it.
    const rows = db
      .prepare(
        "SELECT * FROM emails WHERE user_id = ? ORDER BY received_at DESC, created_at DESC LIMIT 200"
      )
      .all(g.user.id) as EmailRow[];
    return NextResponse.json({ emails: rows });
  } catch (err) {
    return failure("emails.list", err, "server_error");
  }
}
