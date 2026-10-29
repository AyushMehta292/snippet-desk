import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, type UserRow } from "./db";

const SESSION_COOKIE = "session";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db()
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)")
    .run(tokenHash, userId, Date.now());
  return token;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export function userForToken(token: string | undefined | null) {
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db()
    .prepare(
      `SELECT users.id, users.email, users.password_hash, users.created_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(tokenHash) as UserRow | undefined;
  return row ?? null;
}

export function deleteToken(token: string | undefined | null) {
  if (!token) return;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export async function getCurrentUser() {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
}

export async function getUserFromRequest(request: Request) {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return userForToken(header.slice(7).trim());
  }
  return getCurrentUser();
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim();
}

export function guardOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin.startsWith("chrome-extension://")) return null;
  const host = request.headers.get("host");
  if (!host) return null;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return Response.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  if (originHost !== host) {
    return Response.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  return null;
}
