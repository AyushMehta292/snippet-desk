import { sql, type SettingsRow, type SnippetRow } from "./db";
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

export async function listSnippets(userId: string) {
  const db = await sql();
  const rows = await db`
    SELECT id, user_id, name, shortcut, body, created_at, updated_at
    FROM snippets
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `;
  return (rows as SnippetRow[]).map(toPublicSnippet);
}

export async function getSettings(userId: string): Promise<Settings> {
  const db = await sql();
  const rows = await db`
    SELECT user_id, min_cpm, max_cpm, min_mistake_per_100, max_mistake_per_100, tab_size, expand_trigger
    FROM settings
    WHERE user_id = ${userId}
  `;
  return settingsFromRow(rows[0] as SettingsRow | undefined);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
