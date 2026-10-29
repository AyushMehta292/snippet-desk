import { createSession, guardOrigin, setSessionCookie, verifyPassword } from "@/lib/auth";
import { db, type UserRow } from "@/lib/db";
import { readJson } from "@/lib/snippets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const user = db()
    .prepare("SELECT id, email, password_hash, created_at FROM users WHERE email = ?")
    .get(email) as UserRow | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  }
  const token = createSession(user.id);
  await setSessionCookie(token);
  return Response.json({ token, user: { id: user.id, email: user.email } });
}
