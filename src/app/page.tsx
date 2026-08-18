import { getSession } from "@/lib/session";
import { db, type EmailRow } from "@/lib/db";
import Dashboard from "@/components/Dashboard";

// Reads cookies and the database per request.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const session = await getSession();

  // Load the first page of state on the server: no auth flash on load, and no
  // extra round trip before the list renders.
  let emails: EmailRow[] = [];
  if (session.userId) {
    emails = db
      .prepare(
        "SELECT * FROM emails WHERE user_id = ? ORDER BY received_at DESC, created_at DESC LIMIT 200"
      )
      .all(session.userId) as EmailRow[];
  }

  return (
    <Dashboard
      initialAuthed={Boolean(session.userId)}
      initialEmail={session.email ?? null}
      initialEmails={emails}
      oauthError={error ?? null}
    />
  );
}
