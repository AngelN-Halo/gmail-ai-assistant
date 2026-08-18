import { google } from "googleapis";

// Scopes requested from the user's Google account.
// - gmail.readonly: read messages/threads
// - gmail.modify: apply/create labels, create drafts, mark read (does NOT allow permanent delete or send)
// - gmail.send: required only if you want the app to send mail on your behalf (manual, user-triggered)
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getOAuthClient() {
  return new google.auth.OAuth2(
    requiredEnv("GOOGLE_CLIENT_ID"),
    requiredEnv("GOOGLE_CLIENT_SECRET"),
    requiredEnv("GOOGLE_REDIRECT_URI")
  );
}

export function getAuthUrl(state: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // ensures a refresh_token is returned even on repeat logins
    scope: GMAIL_SCOPES,
    state, // verified against a cookie on callback; see lib/oauthState.ts
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export function getAuthorizedClient(refreshToken: string) {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export async function getUserInfo(accessToken: string) {
  const client = getOAuthClient();
  client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data } = await oauth2.userinfo.get();
  return data; // { email, name, ... }
}
