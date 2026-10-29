import { getUserFromRequest, guardOrigin } from "@/lib/auth";
import { db, isUniqueConstraint, type SnippetRow } from "@/lib/db";
import { readJson, toPublicSnippet } from "@/lib/snippets";
import { parseSnippet, prefixWarning } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function loadOwned(userId: string, id: string) {
  return db()
    .prepare("SELECT id, user_id, name, shortcut, body, created_at, updated_at FROM snippets WHERE id = ? AND user_id = ?")
    .get(id, userId) as SnippetRow | undefined;
}

export async function PATCH(request: Request, context: Context) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const current = loadOwned(user.id, id);
  if (!current) return Response.json({ error: "Snippet not found." }, { status: 404 });
  const parsed = parseSnippet(await readJson(request));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const others = (
    db().prepare("SELECT shortcut FROM snippets WHERE user_id = ? AND id != ?").all(user.id, id) as { shortcut: string }[]
  ).map((item) => item.shortcut);
  if (others.includes(parsed.value.shortcut)) {
    return Response.json({ error: "That shortcut is already used." }, { status: 409 });
  }

  try {
    db()
      .prepare("UPDATE snippets SET name = ?, shortcut = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(parsed.value.name, parsed.value.shortcut, parsed.value.body, Date.now(), id, user.id);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return Response.json({ error: "That shortcut is already used." }, { status: 409 });
    }
    throw error;
  }
  const row = loadOwned(user.id, id);
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
  const result = db().prepare("DELETE FROM snippets WHERE id = ? AND user_id = ?").run(id, user.id);
  if (!result.changes) return Response.json({ error: "Snippet not found." }, { status: 404 });
  return Response.json({ ok: true });
}
