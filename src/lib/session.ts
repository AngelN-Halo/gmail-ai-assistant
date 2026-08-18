import { getIronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = {
  userId?: string;
  email?: string;
};

// Serve over HTTPS in any internet-facing deployment: without `secure`, the
// session cookie can be sent in the clear. We key off APP_BASE_URL so a
// production build behind an HTTPS proxy is protected even if NODE_ENV is
// misconfigured.
const isHttps = (process.env.APP_BASE_URL ?? "").startsWith("https://");

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "",
  cookieName: "gmail_ai_session",
  cookieOptions: {
    secure: isHttps || process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax", // must survive the OAuth redirect back from Google
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  },
};

export async function getSession() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error(
      "SESSION_SECRET env var must be set to a random string of at least 32 characters."
    );
  }
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
