import { getUserFromRequest } from "@/lib/auth";
import { sql, type StatusRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const db = await sql();
  const rows = await db`
    SELECT user_id, last_seen, focused, field_kind, host, session_state, detail, progress_index, progress_total
    FROM agent_status
    WHERE user_id = ${user.id}
  `;
  const row = rows[0] as StatusRow | undefined;
  const lastSeen = Number(row?.last_seen) || 0;
  return Response.json({
    online: Boolean(row && Date.now() - lastSeen < 2500),
    focused: Boolean(row?.focused),
    fieldKind: row?.field_kind || "",
    host: row?.host || "",
    sessionState: row?.session_state || "idle",
    detail: row?.detail || "",
    progressIndex: Number(row?.progress_index) || 0,
    progressTotal: Number(row?.progress_total) || 0,
    lastSeen,
  });
}
