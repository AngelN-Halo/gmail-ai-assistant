import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, getUserInfo } from "@/lib/google";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { consumeOAuthState } from "@/lib/oauthState";
import { isAllowedEmail } from "@/lib/security";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const baseUrl = process.env.APP_BASE_URL || req.nextUrl.origin;

  const fail = (reason: string) =>
    NextResponse.redirect(`${baseUrl}/?error=${encodeURIComponent(reason)}`);

  if (error) return fail(error);

  // Verify CSRF state before doing anything with the code.
  if (!(await consumeOAuthState(state))) {
    return fail("invalid_state_please_retry");
  }

  if (!code) return fail("missing_code");

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.access_token) return fail("no_access_token");

    const userInfo = await getUserInfo(tokens.access_token);
    if (!userInfo.email) return fail("no_email");

    // Access control: only explicitly permitted accounts may connect.
    if (!isAllowedEmail(userInfo.email)) {
      console.warn(`Rejected sign-in attempt from non-allowlisted address: ${userInfo.email}`);
      return fail("account_not_authorized");
    }

    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(userInfo.email) as { id: string } | undefined;

    // Google only returns a refresh_token on first consent (or with
    // prompt=consent). Keep any previously stored one rather than wiping it.
    if (!tokens.refresh_token && !existing) {
      return fail("no_refresh_token_revoke_and_retry");
    }

    let userId: string;
    if (existing) {
      userId = existing.id;
      if (tokens.refresh_token) {
        db.prepare("UPDATE users SET refresh_token = ? WHERE id = ?").run(
          encrypt(tokens.refresh_token),
          userId
        );
      }
    } else {
      userId = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, email, refresh_token) VALUES (?, ?, ?)").run(
        userId,
        userInfo.email,
        encrypt(tokens.refresh_token!)
      );
    }

    const session = await getSession();
    session.userId = userId;
    session.email = userInfo.email;
    await session.save();

    return NextResponse.redirect(`${baseUrl}/`);
  } catch (err) {
    console.error("OAuth callback error", err);
    return fail("oauth_failed");
  }
}
