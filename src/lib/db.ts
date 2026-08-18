import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "app.db");

// Reuse a single connection across hot-reloads in dev.
const globalForDb = globalThis as unknown as { __db?: Database.Database };

export const db = globalForDb.__db ?? new Database(dbPath);
if (process.env.NODE_ENV !== "production") globalForDb.__db = db;

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    refresh_token TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,          -- gmail message id
    user_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT,              -- RFC-822 Message-ID header, for reply threading
    from_addr TEXT,
    to_addr TEXT,
    subject TEXT,
    snippet TEXT,
    body_text TEXT,
    received_at TEXT,
    category TEXT,
    priority TEXT,
    ai_reasoning TEXT,
    draft_text TEXT,
    gmail_draft_id TEXT,
    labeled INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id);
  CREATE INDEX IF NOT EXISTS idx_emails_received ON emails(user_id, received_at DESC);
`);

// Migration for databases created before message_id existed.
const emailColumns = db.prepare("PRAGMA table_info(emails)").all() as { name: string }[];
if (!emailColumns.some((c) => c.name === "message_id")) {
  db.exec("ALTER TABLE emails ADD COLUMN message_id TEXT");
}

export type UserRow = {
  id: string;
  email: string;
  refresh_token: string;
  created_at: string;
};

export type EmailRow = {
  id: string;
  user_id: string;
  thread_id: string;
  message_id: string | null;
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
  created_at: string;
};
