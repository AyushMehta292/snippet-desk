import { getUserFromRequest } from "@/lib/auth";
import { db, type CommandRow } from "@/lib/db";
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

  db()
    .prepare(
      `INSERT INTO agent_status (
         user_id, last_seen, focused, field_kind, host, session_state, detail, progress_index, progress_total
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         focused = excluded.focused,
         field_kind = excluded.field_kind,
         host = excluded.host,
         session_state = excluded.session_state,
         detail = excluded.detail,
         progress_index = excluded.progress_index,
         progress_total = excluded.progress_total`,
    )
    .run(user.id, now, status.focused ? 1 : 0, fieldKind, host, sessionState, detail, progressIndex, progressTotal);

  const command = db()
    .prepare("SELECT user_id, seq, action, snippet_id, body, created_at FROM agent_commands WHERE user_id = ?")
    .get(user.id) as CommandRow | undefined;
  const fresh = Boolean(command && now - command.created_at < 15_000);

  return Response.json({
    seq: command?.seq ?? 0,
    command:
      command && fresh && lastSeq < command.seq
        ? { action: command.action, snippetId: command.snippet_id, body: command.body }
        : null,
    snippets: listSnippets(user.id),
    settings: getSettings(user.id),
  });
}
