import { getUserFromRequest, guardOrigin } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getSettings, readJson } from "@/lib/snippets";
import { parseSettings } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ settings: await getSettings(user.id) });
}

export async function PUT(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  const parsed = parseSettings(await readJson(request));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const settings = parsed.value;
  const db = await sql();
  await db`
    INSERT INTO settings (
      user_id, min_cpm, max_cpm, min_mistake_per_100, max_mistake_per_100, tab_size, expand_trigger
    ) VALUES (
      ${user.id},
      ${settings.minCpm},
      ${settings.maxCpm},
      ${settings.minMistakePer100},
      ${settings.maxMistakePer100},
      ${settings.tabSize},
      ${settings.expandTrigger}
    )
    ON CONFLICT(user_id) DO UPDATE SET
      min_cpm = excluded.min_cpm,
      max_cpm = excluded.max_cpm,
      min_mistake_per_100 = excluded.min_mistake_per_100,
      max_mistake_per_100 = excluded.max_mistake_per_100,
      tab_size = excluded.tab_size,
      expand_trigger = excluded.expand_trigger
  `;
  return Response.json({ settings: await getSettings(user.id) });
}
