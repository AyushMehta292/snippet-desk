import { getUserFromRequest, guardOrigin } from "@/lib/auth";
import { isUniqueConstraint, sql, type SnippetRow } from "@/lib/db";
import { readJson, toPublicSnippet } from "@/lib/snippets";
import { parseSnippet, prefixWarning } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function loadOwned(userId: string, id: string) {
  const db = await sql();
  const rows = await db`
    SELECT id, user_id, name, shortcut, body, created_at, updated_at
    FROM snippets
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return rows[0] as SnippetRow | undefined;
}

export async function PATCH(request: Request, context: Context) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const current = await loadOwned(user.id, id);
  if (!current) return Response.json({ error: "Snippet not found." }, { status: 404 });
  const parsed = parseSnippet(await readJson(request));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const db = await sql();
  const others = (
    (await db`SELECT shortcut FROM snippets WHERE user_id = ${user.id} AND id <> ${id}`) as { shortcut: string }[]
  ).map((item) => item.shortcut);
  if (others.includes(parsed.value.shortcut)) {
    return Response.json({ error: "That shortcut is already used." }, { status: 409 });
  }

  const snippet = parsed.value;
  try {
    await db`
      UPDATE snippets
      SET name = ${snippet.name}, shortcut = ${snippet.shortcut}, body = ${snippet.body}, updated_at = ${Date.now()}
      WHERE id = ${id} AND user_id = ${user.id}
    `;
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return Response.json({ error: "That shortcut is already used." }, { status: 409 });
    }
    throw error;
  }
  const row = await loadOwned(user.id, id);
  return Response.json({
    snippet: row ? toPublicSnippet(row) : null,
    warning: prefixWarning(parsed.value.shortcut, others),
  });
}

export async function DELETE(request: Request, context: Context) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const db = await sql();
  const removed = await db`DELETE FROM snippets WHERE id = ${id} AND user_id = ${user.id} RETURNING id`;
  if (removed.length === 0) return Response.json({ error: "Snippet not found." }, { status: 404 });
  return Response.json({ ok: true });
}
