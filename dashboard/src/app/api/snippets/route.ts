import { randomUUID } from "node:crypto";
import { getUserFromRequest, guardOrigin } from "@/lib/auth";
import { db, isUniqueConstraint } from "@/lib/db";
import { listSnippets, readJson, toPublicSnippet } from "@/lib/snippets";
import { parseSnippet, prefixWarning } from "@/lib/validators";
import type { SnippetRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ snippets: listSnippets(user.id) });
}

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const parsed = parseSnippet(await readJson(request));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const taken = db()
    .prepare("SELECT shortcut FROM snippets WHERE user_id = ?")
    .all(user.id) as { shortcut: string }[];
  if (taken.some((item) => item.shortcut === parsed.value.shortcut)) {
    return Response.json({ error: "That shortcut is already used." }, { status: 409 });
  }

  const now = Date.now();
  const id = randomUUID();
  try {
    db()
      .prepare(
        "INSERT INTO snippets (id, user_id, name, shortcut, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, user.id, parsed.value.name, parsed.value.shortcut, parsed.value.body, now, now);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return Response.json({ error: "That shortcut is already used." }, { status: 409 });
    }
    throw error;
  }
  const row = db()
    .prepare("SELECT id, user_id, name, shortcut, body, created_at, updated_at FROM snippets WHERE id = ?")
    .get(id) as SnippetRow;
  return Response.json({
    snippet: toPublicSnippet(row),
    warning: prefixWarning(parsed.value.shortcut, taken.map((item) => item.shortcut)),
  });
}
