import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { gmail_v1 } from "googleapis";

export type ParsedEmail = {
  id: string;
  threadId: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAt: string;
};

function getHeader(headers: { name?: string | null; value?: string | null }[] | undefined, name: string): string {
  const h = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64").toString("utf8");
}

function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // fallback: recurse into multipart/alternative etc.
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  // last resort: html body, stripped of tags
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ");
  }
  return "";
}

export async function listRecentMessages(
  auth: OAuth2Client,
  opts: { maxResults?: number; query?: string } = {}
): Promise<ParsedEmail[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.messages.list({
    userId: "me",
    maxResults: opts.maxResults ?? 20,
    q: opts.query ?? "in:inbox",
  });

  const messages = list.data.messages ?? [];
  const results: ParsedEmail[] = [];

  for (const m of messages) {
    if (!m.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "full",
    });
    const headers = full.data.payload?.headers ?? [];
    results.push({
      id: full.data.id!,
      threadId: full.data.threadId!,
      messageId: getHeader(headers, "Message-ID"),
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      snippet: full.data.snippet ?? "",
      bodyText: extractPlainText(full.data.payload).slice(0, 6000),
      receivedAt: full.data.internalDate
        ? new Date(Number(full.data.internalDate)).toISOString()
        : new Date(0).toISOString(),
    });
  }

  return results;
}

export async function ensureLabel(auth: OAuth2Client, name: string): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = list.data.labels?.find((l) => l.name === name);
  if (existing?.id) return existing.id;

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  return created.data.id!;
}

export async function applyLabel(auth: OAuth2Client, messageId: string, labelId: string) {
  const gmail = google.gmail({ version: "v1", auth });
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
}

// Header values come from untrusted email content, so any CR/LF must be
// stripped before they reach a header line — otherwise a crafted Subject or
// From can inject arbitrary headers (Bcc, Reply-To) into the outgoing message.
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// RFC 2047 encoded-word, so non-ASCII subjects survive as UTF-8.
function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function buildRawMessage(opts: {
  to: string;
  subject: string;
  body: string;
  inReplyToMessageId?: string;
  threadId?: string;
}): string {
  const to = sanitizeHeaderValue(opts.to);
  if (!to) throw new Error("Cannot build message: empty recipient");

  const lines = [
    `To: ${encodeHeaderValue(to)}`,
    `Subject: ${encodeHeaderValue(opts.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];

  // Must be the RFC-822 Message-ID header of the message being replied to
  // (e.g. "<abc@mail.gmail.com>"), not Gmail's internal message id.
  const inReplyTo = opts.inReplyToMessageId
    ? sanitizeHeaderValue(opts.inReplyToMessageId)
    : "";
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }

  lines.push("", opts.body);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function createDraft(
  auth: OAuth2Client,
  opts: { to: string; subject: string; body: string; threadId?: string; inReplyToMessageId?: string }
): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });
  const raw = buildRawMessage(opts);
  const draft = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw,
        threadId: opts.threadId,
      },
    },
  });
  return draft.data.id!;
}

export async function updateDraft(
  auth: OAuth2Client,
  draftId: string,
  opts: { to: string; subject: string; body: string; threadId?: string; inReplyToMessageId?: string }
) {
  const gmail = google.gmail({ version: "v1", auth });
  const raw = buildRawMessage(opts);
  await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody: {
      message: { raw, threadId: opts.threadId },
    },
  });
}

// Explicit, user-triggered send. Not called automatically anywhere in this app.
export async function sendDraft(auth: OAuth2Client, draftId: string) {
  const gmail = google.gmail({ version: "v1", auth });
  await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
}
