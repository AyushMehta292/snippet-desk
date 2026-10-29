import { randomUUID } from "node:crypto";
import { getUserFromRequest, guardOrigin } from "@/lib/auth";
import { isUniqueConstraint, sql, type SnippetRow } from "@/lib/db";
import { listSnippets, readJson, toPublicSnippet } from "@/lib/snippets";
import { parseSnippet, prefixWarning } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ snippets: await listSnippets(user.id) });
}

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const parsed = parseSnippet(await readJson(request));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const db = await sql();
  const taken = (await db`SELECT shortcut FROM snippets WHERE user_id = ${user.id}`) as { shortcut: string }[];
  if (taken.some((item) => item.shortcut === parsed.value.shortcut)) {
    return Response.json({ error: "That shortcut is already used." }, { status: 409 });
  }

  const now = Date.now();
  const id = randomUUID();
  const snippet = parsed.value;
  try {
    await db`
      INSERT INTO snippets (id, user_id, name, shortcut, body, created_at, updated_at)
      VALUES (${id}, ${user.id}, ${snippet.name}, ${snippet.shortcut}, ${snippet.body}, ${now}, ${now})
    `;
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return Response.json({ error: "That shortcut is already used." }, { status: 409 });
    }
    throw error;
  }
  const rows = await db`
    SELECT id, user_id, name, shortcut, body, created_at, updated_at FROM snippets WHERE id = ${id}
  `;
  const row = rows[0] as SnippetRow;
  return Response.json({
    snippet: toPublicSnippet(row),
    warning: prefixWarning(parsed.value.shortcut, taken.map((item) => item.shortcut)),
  });
}
