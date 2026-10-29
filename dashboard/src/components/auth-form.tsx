"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { errorText, readResponseJson } from "@/lib/read-response";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const register = mode === "register";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (register && password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(register ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await readResponseJson(response);
      if (!response.ok) {
        setError(errorText(data, "Could not continue."));
        return;
      }
      router.push("/snippets");
      router.refresh();
    } catch {
      setError("Could not continue.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="panel auth-card">
        <h1>{register ? "Create your desk" : "Welcome back"}</h1>
        <p className="lede">{register ? "Snippets stay on this machine." : "Sign in to edit snippets and control typing."}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete={register ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
          </label>
          {register ? (
            <label className="field">
              <span>Confirm password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={8} />
            </label>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit" disabled={pending}>{register ? "Create account" : "Sign in"}</button>
        </form>
        <p className="lede">
          {register ? (
            <Link href="/login">Already have an account</Link>
          ) : (
            <Link href="/register">Create an account</Link>
          )}
        </p>
      </div>
    </div>
  );
}
