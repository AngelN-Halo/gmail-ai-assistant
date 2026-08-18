import crypto from "crypto";
import { cookies } from "next/headers";

// CSRF protection for the OAuth round trip. We generate a random nonce, put it
// in both a short-lived httpOnly cookie and the `state` query parameter, then
// require them to match on callback. Without this, an attacker can feed their
// own `code` to the callback and link their Gmail account to the victim's
// session (or vice versa).

const COOKIE_NAME = "oauth_state";
const MAX_AGE_SECONDS = 600; // 10 minutes to complete the consent screen

export async function createOAuthState(): Promise<string> {
  const nonce = crypto.randomBytes(32).toString("base64url");
  const store = await cookies();
  store.set(COOKIE_NAME, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive Google's cross-site redirect back to us
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return nonce;
}

export async function consumeOAuthState(received: string | null): Promise<boolean> {
  const store = await cookies();
  const expected = store.get(COOKIE_NAME)?.value;

  // Single-use: clear it regardless of the outcome so a state can't be replayed.
  store.delete(COOKIE_NAME);

  if (!expected || !received) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
