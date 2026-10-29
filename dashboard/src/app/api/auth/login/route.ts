import { createSession, guardOrigin, setSessionCookie, verifyPassword } from "@/lib/auth";
import { sql, type UserRow } from "@/lib/db";
import { readJson } from "@/lib/snippets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const db = await sql();
  const users = await db`SELECT id, email, password_hash, created_at FROM users WHERE email = ${email}`;
  const user = users[0] as UserRow | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  const token = await createSession(user.id);
  await setSessionCookie(token);
  return Response.json({ token, user: { id: user.id, email: user.email } });
}
