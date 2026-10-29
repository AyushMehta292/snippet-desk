import { bearerToken, clearSessionCookie, deleteToken } from "@/lib/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (token) {
    await deleteToken(token);
    return Response.json({ ok: true });
  }
  const jar = await cookies();
  await deleteToken(jar.get("session")?.value);
  await clearSessionCookie();
  return Response.json({ ok: true });
}
