import { NextRequest, NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google";
import { createOAuthState } from "@/lib/oauthState";
import { checkRateLimit, LIMITS } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const retryAfter = checkRateLimit(`login:${ip}`, LIMITS.login);
  if (retryAfter !== null) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const state = await createOAuthState();
  return NextResponse.redirect(getAuthUrl(state));
}
