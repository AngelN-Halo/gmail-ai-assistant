import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/requireUser";
import { hasValidOrigin } from "@/lib/security";
import { checkRateLimit, type RateLimit } from "@/lib/rateLimit";
import type { UserRow } from "@/lib/db";
import type { OAuth2Client } from "google-auth-library";

type GuardResult =
  | { ok: true; user: UserRow; auth: OAuth2Client }
  | { ok: false; response: NextResponse };

/**
 * Shared entry check for API routes: same-origin, authenticated, within rate
 * limit. Pass a rule to rate-limit the route (keyed per user).
 */
export async function guard(
  req: Request,
  opts: { rule?: RateLimit; bucket?: string; checkOrigin?: boolean } = {}
): Promise<GuardResult> {
  if (opts.checkOrigin !== false && !hasValidOrigin(req)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_origin" }, { status: 403 }),
    };
  }

  let user: UserRow;
  let auth: OAuth2Client;
  try {
    ({ user, auth } = await requireUser());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return {
        ok: false,
        response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      };
    }
    throw err;
  }

  if (opts.rule && opts.bucket) {
    const retryAfter = checkRateLimit(`${opts.bucket}:${user.id}`, opts.rule);
    if (retryAfter !== null) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "rate_limited", retryAfter },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        ),
      };
    }
  }

  return { ok: true, user, auth };
}

/**
 * Log the real error server-side, return an opaque code to the client.
 * Error details can carry file paths, tokens, and upstream URLs — never ship
 * them to the browser on an internet-facing deployment.
 */
export function failure(context: string, err: unknown, code: string): NextResponse {
  console.error(`[${context}]`, err);
  return NextResponse.json({ error: code }, { status: 500 });
}
