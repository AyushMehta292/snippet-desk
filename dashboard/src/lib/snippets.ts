import { db, type SettingsRow, type SnippetRow } from "./db";
import { settingsFromRow, type Settings } from "./validators";

export type PublicSnippet = {
  id: string;
  name: string;
  shortcut: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export function toPublicSnippet(row: SnippetRow): PublicSnippet {
  return {
    id: row.id,
    name: row.name,
    shortcut: row.shortcut,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSnippets(userId: string) {
  const rows = db()
    .prepare(
      "SELECT id, user_id, name, shortcut, body, created_at, updated_at FROM snippets WHERE user_id = ? ORDER BY updated_at DESC",
    )
    .all(userId) as SnippetRow[];
  return rows.map(toPublicSnippet);
}

export function getSettings(userId: string): Settings {
  const row = db()
    .prepare(
      "SELECT user_id, min_cpm, max_cpm, min_mistake_per_100, max_mistake_per_100, tab_size, expand_trigger FROM settings WHERE user_id = ?",
    )
    .get(userId) as SettingsRow | undefined;
  return settingsFromRow(row);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
