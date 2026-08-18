import { getSession } from "@/lib/session";
import { db, UserRow } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getAuthorizedClient } from "@/lib/google";

export class UnauthorizedError extends Error {}

/** Loads the current session's user + a ready-to-use Gmail OAuth client, or throws. */
export async function requireUser() {
  const session = await getSession();
  if (!session.userId) throw new UnauthorizedError("Not signed in");

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId) as
    | UserRow
    | undefined;
  if (!user) throw new UnauthorizedError("User not found");

  const refreshToken = decrypt(user.refresh_token);
  const auth = getAuthorizedClient(refreshToken);
  return { user, auth };
}
