import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasValidOrigin } from "@/lib/security";

export async function POST(req: Request) {
  if (!hasValidOrigin(req)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
