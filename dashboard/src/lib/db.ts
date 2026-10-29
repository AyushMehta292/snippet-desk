import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const globalForDb = globalThis as unknown as { snippetDb?: DatabaseSync };

function openDatabase() {
  const directory = path.join(process.cwd(), "data");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "snippets.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      shortcut TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (user_id, shortcut),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      min_cpm INTEGER NOT NULL,
      max_cpm INTEGER NOT NULL,
      min_mistake_per_100 REAL NOT NULL,
      max_mistake_per_100 REAL NOT NULL,
      tab_size INTEGER NOT NULL,
      expand_trigger TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_commands (
      user_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      action TEXT NOT NULL,
      snippet_id TEXT,
      body TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_status (
      user_id TEXT PRIMARY KEY,
      last_seen INTEGER NOT NULL,
      focused INTEGER NOT NULL,
      field_kind TEXT NOT NULL,
      host TEXT NOT NULL,
      session_state TEXT NOT NULL,
      detail TEXT NOT NULL,
      progress_index INTEGER NOT NULL,
      progress_total INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  return db;
}

export function db() {
  if (!globalForDb.snippetDb) globalForDb.snippetDb = openDatabase();
  return globalForDb.snippetDb;
}

export function isUniqueConstraint(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code.startsWith("SQLITE_CONSTRAINT") || message.includes("UNIQUE constraint failed");
}

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
};

export type SnippetRow = {
  id: string;
  user_id: string;
  name: string;
  shortcut: string;
  body: string;
  created_at: number;
  updated_at: number;
};

export type SettingsRow = {
  user_id: string;
  min_cpm: number;
  max_cpm: number;
  min_mistake_per_100: number;
  max_mistake_per_100: number;
  tab_size: number;
  expand_trigger: string;
};

export type CommandRow = {
  user_id: string;
  seq: number;
  action: string;
  snippet_id: string | null;
  body: string | null;
  created_at: number;
};

export type StatusRow = {
  user_id: string;
  last_seen: number;
  focused: number;
  field_kind: string;
  host: string;
  session_state: string;
  detail: string;
  progress_index: number;
  progress_total: number;
};
