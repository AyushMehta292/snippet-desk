import { getUserFromRequest } from "@/lib/auth";
import { sql, type CommandRow } from "@/lib/db";
import { getSettings, listSnippets, readJson } from "@/lib/snippets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusInput = {
  focused?: unknown;
  fieldKind?: unknown;
  host?: unknown;
  sessionState?: unknown;
  detail?: unknown;
  progressIndex?: unknown;
  progressTotal?: unknown;
};

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await readJson(request);
  const lastSeq = Number(body?.lastSeq) || 0;
  const status = (body?.status || {}) as StatusInput;
  const now = Date.now();
  const fieldKind = typeof status.fieldKind === "string" ? status.fieldKind.slice(0, 40) : "";
  const host = typeof status.host === "string" ? status.host.slice(0, 200) : "";
  const detail = typeof status.detail === "string" ? status.detail.slice(0, 300) : "";
  const sessionState = typeof status.sessionState === "string" ? status.sessionState.slice(0, 40) : "idle";
  const progressIndex = Number(status.progressIndex) || 0;
  const progressTotal = Number(status.progressTotal) || 0;

  const db = await sql();
  await db`
    INSERT INTO agent_status (
      user_id, last_seen, focused, field_kind, host, session_state, detail, progress_index, progress_total
    ) VALUES (
      ${user.id}, ${now}, ${Boolean(status.focused)}, ${fieldKind}, ${host}, ${sessionState}, ${detail}, ${progressIndex}, ${progressTotal}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      focused = excluded.focused,
      field_kind = excluded.field_kind,
      host = excluded.host,
      session_state = excluded.session_state,
      detail = excluded.detail,
      progress_index = excluded.progress_index,
      progress_total = excluded.progress_total
  `;

  const commands = await db`
    SELECT user_id, seq, action, snippet_id, body, created_at FROM agent_commands WHERE user_id = ${user.id}
  `;
  const command = commands[0] as CommandRow | undefined;
  const fresh = Boolean(command && now - Number(command.created_at) < 15_000);
  const seq = Number(command?.seq) || 0;

  return Response.json({
    seq,
    command:
      command && fresh && lastSeq < seq
        ? { action: command.action, snippetId: command.snippet_id, body: command.body }
        : null,
    snippets: await listSnippets(user.id),
    settings: await getSettings(user.id),
  });
}
