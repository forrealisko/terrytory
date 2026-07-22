"use client";

import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      window.location.href = "/admin";
    } else {
      setError("Invalid username or password");
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-glow" aria-hidden />
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="login-mark" aria-hidden>
            T
          </span>
          <span className="login-word">
            Terry<span>tory</span>
          </span>
        </div>
        <p className="login-sub">Sign in to the newsroom</p>

        <div className="login-field">
          <label htmlFor="login-user">Username</label>
          <input
            id="login-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            placeholder="you"
          />
        </div>

        <div className="login-field">
          <label htmlFor="login-pass">Password</label>
          <input
            id="login-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" disabled={busy || !username || !password}>
          {busy ? (
            <>
              <span className="login-spinner" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>

        <p className="login-hint">Private · invite-only — no public registration</p>
      </form>
    </div>
  );
}
