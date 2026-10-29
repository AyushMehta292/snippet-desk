import { getUserFromRequest } from "@/lib/auth";
import { db, type StatusRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const row = db()
    .prepare(
      "SELECT user_id, last_seen, focused, field_kind, host, session_state, detail, progress_index, progress_total FROM agent_status WHERE user_id = ?",
    )
    .get(user.id) as StatusRow | undefined;
  return Response.json({
    online: Boolean(row && Date.now() - row.last_seen < 2500),
    focused: Boolean(row?.focused),
    fieldKind: row?.field_kind || "",
    host: row?.host || "",
    sessionState: row?.session_state || "idle",
    detail: row?.detail || "",
    progressIndex: row?.progress_index || 0,
    progressTotal: row?.progress_total || 0,
    lastSeen: row?.last_seen || 0,
  });
}
