"use client";

import { useCallback, useState } from "react";

type EmailRow = {
  id: string;
  thread_id: string;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  received_at: string | null;
  category: string | null;
  priority: string | null;
  ai_reasoning: string | null;
  draft_text: string | null;
  gmail_draft_id: string | null;
  labeled: number;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state_please_retry:
    "Sign-in session expired or was tampered with. Please try connecting again.",
  account_not_authorized:
    "That Google account isn't on this server's allow list. Ask the operator to add it to ALLOWED_EMAILS.",
  no_refresh_token_revoke_and_retry:
    "Google didn't return a refresh token. Remove this app at myaccount.google.com/permissions, then reconnect.",
  access_denied: "You declined the permission request.",
  oauth_failed: "Could not complete Google sign-in. Please try again.",
  rate_limited: "You're going too fast — wait a bit and try again.",
  invalid_origin: "Request blocked: unexpected origin.",
  unauthorized: "Your session expired. Please sign in again.",
  sync_failed: "Could not fetch mail from Gmail. Check the server logs.",
  classify_failed: "The AI model could not be reached. Check that your model server is running.",
  draft_failed: "The AI model could not be reached. Check that your model server is running.",
  save_draft_failed: "Could not save the draft to Gmail. Check the server logs.",
  send_failed: "Could not send the message. Check the server logs.",
};

function humanizeError(code: string): string {
  return ERROR_MESSAGES[code] ?? code;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

type DashboardProps = {
  initialAuthed: boolean;
  initialEmail: string | null;
  initialEmails: EmailRow[];
  oauthError: string | null;
};

export default function Dashboard({
  initialAuthed,
  initialEmail,
  initialEmails,
  oauthError,
}: DashboardProps) {
  const [authed, setAuthed] = useState<boolean>(initialAuthed);
  const [email] = useState<string | null>(initialEmail);
  const [emails, setEmails] = useState<EmailRow[]>(initialEmails);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftDrafts, setDraftDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/emails");
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      setEmails(data.emails ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // An error from a user action takes precedence over the one in the URL.
  const displayError = error ?? (oauthError ? humanizeError(oauthError) : null);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/emails/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxResults: 20 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sync_failed");
      await loadEmails();
    } catch (e) {
      setError(e instanceof Error ? humanizeError(e.message) : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleClassify(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/emails/${id}/classify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "classify_failed");
      await loadEmails();
    } catch (e) {
      setError(e instanceof Error ? humanizeError(e.message) : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleGenerateDraft(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/emails/${id}/draft`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "draft_failed");
      setDraftDrafts((prev) => ({ ...prev, [id]: data.draftText }));
      setExpandedId(id);
      await loadEmails();
    } catch (e) {
      setError(e instanceof Error ? humanizeError(e.message) : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSaveDraft(id: string, text: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/emails/${id}/save-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save_draft_failed");
      await loadEmails();
    } catch (e) {
      setError(e instanceof Error ? humanizeError(e.message) : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSend(id: string) {
    if (!window.confirm("Send this reply from your Gmail account now? This cannot be undone.")) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/emails/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "send_failed");
      await loadEmails();
    } catch (e) {
      setError(e instanceof Error ? humanizeError(e.message) : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthed(false);
    setEmails([]);
  }

  if (!authed) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Gmail AI Assistant
        </h1>
        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Connect your Gmail account to sort, classify, and draft AI-assisted replies. Nothing is
          ever sent without your explicit confirmation.
        </p>
        {displayError && <p className="text-sm text-red-600">{displayError}</p>}
        <a
          href="/api/auth/google/login"
          className="rounded-full bg-black px-6 py-3 font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Connect Gmail
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Gmail AI Assistant
          </h1>
          <p className="text-sm text-zinc-500">{email}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {syncing ? "Syncing…" : "Sync Inbox"}
          </button>
          <button
            onClick={handleLogout}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >
            Log out
          </button>
        </div>
      </header>

      {displayError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {displayError}
        </div>
      )}

      {loading && emails.length === 0 && <p className="text-zinc-500">Loading emails…</p>}

      {!loading && emails.length === 0 && (
        <p className="text-zinc-500">No emails yet. Click &ldquo;Sync Inbox&rdquo; to fetch recent mail.</p>
      )}

      <ul className="flex flex-col gap-3">
        {emails.map((e) => {
          const expanded = expandedId === e.id;
          const draftText = draftDrafts[e.id] ?? e.draft_text ?? "";
          return (
            <li
              key={e.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div
                className="flex cursor-pointer flex-col gap-1"
                onClick={() => setExpandedId(expanded ? null : e.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                    {e.subject || "(no subject)"}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    {e.category && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {e.category}
                      </span>
                    )}
                    {e.priority && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${PRIORITY_COLORS[e.priority] ?? ""}`}
                      >
                        {e.priority}
                      </span>
                    )}
                  </div>
                </div>
                <span className="truncate text-sm text-zinc-500">{e.from_addr}</span>
                <span className="truncate text-sm text-zinc-400">{e.snippet}</span>
              </div>

              {expanded && (
                <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  {e.ai_reasoning && (
                    <p className="text-xs italic text-zinc-500">Why: {e.ai_reasoning}</p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleClassify(e.id)}
                      disabled={busyId === e.id}
                      className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      {busyId === e.id ? "Working…" : e.category ? "Re-classify" : "Classify"}
                    </button>
                    <button
                      onClick={() => handleGenerateDraft(e.id)}
                      disabled={busyId === e.id}
                      className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
                    >
                      {busyId === e.id ? "Working…" : "Generate AI Reply Draft"}
                    </button>
                  </div>

                  {(draftText || draftDrafts[e.id] !== undefined) && (
                    <div className="flex flex-col gap-2">
                      <textarea
                        className="min-h-[140px] w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        value={draftText}
                        onChange={(ev) =>
                          setDraftDrafts((prev) => ({ ...prev, [e.id]: ev.target.value }))
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleSaveDraft(e.id, draftText)}
                          disabled={busyId === e.id || !draftText.trim()}
                          className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                        >
                          {e.gmail_draft_id ? "Update Gmail Draft" : "Save as Gmail Draft"}
                        </button>
                        <button
                          onClick={() => handleSend(e.id)}
                          disabled={busyId === e.id || !e.gmail_draft_id}
                          title={!e.gmail_draft_id ? "Save as a Gmail draft first" : undefined}
                          className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Send Now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
