import { neon } from "@neondatabase/serverless";

type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

const globalForDb = globalThis as unknown as { snippetSql?: Promise<Query> };

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add the Neon connection string from the Vercel project.");
  }
  return url;
}

async function openDatabase() {
  const sql = neon(databaseUrl());
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      shortcut TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE (user_id, shortcut)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      min_cpm INTEGER NOT NULL,
      max_cpm INTEGER NOT NULL,
      min_mistake_per_100 DOUBLE PRECISION NOT NULL,
      max_mistake_per_100 DOUBLE PRECISION NOT NULL,
      tab_size INTEGER NOT NULL,
      expand_trigger TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_commands (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      action TEXT NOT NULL,
      snippet_id TEXT,
      body TEXT,
      created_at BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_status (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_seen BIGINT NOT NULL,
      focused BOOLEAN NOT NULL,
      field_kind TEXT NOT NULL,
      host TEXT NOT NULL,
      session_state TEXT NOT NULL,
      detail TEXT NOT NULL,
      progress_index INTEGER NOT NULL,
      progress_total INTEGER NOT NULL
    )
  `;
  return (async (strings, ...values) => sql(strings, ...values)) as Query;
}

export async function sql() {
  if (!globalForDb.snippetSql) {
    globalForDb.snippetSql = openDatabase().catch((error: unknown) => {
      globalForDb.snippetSql = undefined;
      throw error;
    });
  }
  return globalForDb.snippetSql;
}

export function isUniqueConstraint(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "23505" || message.includes("duplicate key") || message.includes("UNIQUE constraint failed");
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
  focused: boolean;
  field_kind: string;
  host: string;
  session_state: string;
  detail: string;
  progress_index: number;
  progress_total: number;
};
