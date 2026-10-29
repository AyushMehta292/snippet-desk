import { randomUUID } from "node:crypto";
import { createSession, guardOrigin, hashPassword, setSessionCookie } from "@/lib/auth";
import { db, isUniqueConstraint } from "@/lib/db";
import { readJson } from "@/lib/snippets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const body = await readJson(request);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8 || password.length > 200) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  const existing = db().prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return Response.json({ error: "An account with that email already exists." }, { status: 409 });

  const id = randomUUID();
  try {
    db()
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, email, hashPassword(password), Date.now());
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    throw error;
  }
  const token = createSession(id);
  await setSessionCookie(token);
  return Response.json({ token, user: { id, email } });
}
