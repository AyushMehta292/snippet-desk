import { getUserFromRequest, guardOrigin } from "@/lib/auth";
import { sql, type CommandRow, type SnippetRow } from "@/lib/db";
import { readJson } from "@/lib/snippets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["start", "pause", "resume", "stop"]);

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await readJson(request);
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) return Response.json({ error: "Unknown control." }, { status: 400 });

  let snippetId: string | null = null;
  let snippetBody: string | null = null;
  if (action === "start") {
    const id = typeof body?.snippetId === "string" ? body.snippetId : "";
    const db = await sql();
    const found = await db`
      SELECT id, user_id, name, shortcut, body, created_at, updated_at
      FROM snippets
      WHERE id = ${id} AND user_id = ${user.id}
    `;
    const snippet = found[0] as SnippetRow | undefined;
    if (!snippet) return Response.json({ error: "Choose a snippet first." }, { status: 404 });
    snippetId = snippet.id;
    snippetBody = snippet.body;
  }

  const db = await sql();
  await db`
    INSERT INTO agent_commands (user_id, seq, action, snippet_id, body, created_at)
    VALUES (${user.id}, 1, ${action}, ${snippetId}, ${snippetBody}, ${Date.now()})
    ON CONFLICT(user_id) DO UPDATE SET
      seq = agent_commands.seq + 1,
      action = excluded.action,
      snippet_id = excluded.snippet_id,
      body = excluded.body,
      created_at = excluded.created_at
  `;

  const commands = await db`
    SELECT user_id, seq, action, snippet_id, body, created_at FROM agent_commands WHERE user_id = ${user.id}
  `;
  const command = commands[0] as CommandRow;
  return Response.json({ seq: Number(command.seq) || 0, action: command.action });
}
