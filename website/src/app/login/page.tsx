"use client";

import { useState, type CSSProperties } from "react";

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
    <div style={styles.wrap}>
      <form style={styles.card} onSubmit={submit}>
        <div style={styles.brand}>
          TERRY<span style={{ color: "var(--accent-brand, #00e676)" }}>TORY</span>
        </div>
        <p style={styles.sub}>Admin access</p>

        <label style={styles.label}>Username</label>
        <input
          style={styles.input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
        />

        <label style={styles.label}>Password</label>
        <input
          style={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {error && <div style={styles.error}>{error}</div>}

        <button style={{ ...styles.button, opacity: busy ? 0.6 : 1 }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p style={styles.hint}>Placeholder — username: admin · password: password</p>
      </form>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg-primary, #0b0c0f)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 32,
    background: "var(--bg-elevated, #16181d)",
    border: "1px solid var(--border, #24272e)",
    borderRadius: 14,
  },
  brand: { fontSize: 24, fontWeight: 800, letterSpacing: "0.02em", color: "#fff" },
  sub: { margin: "0 0 18px", fontSize: 13, color: "var(--text-muted, #8a909a)" },
  label: { fontSize: 12, color: "var(--text-muted, #8a909a)", marginTop: 8 },
  input: {
    padding: "10px 12px",
    fontSize: 14,
    background: "var(--bg-primary, #0b0c0f)",
    border: "1px solid var(--border, #24272e)",
    borderRadius: 8,
    color: "#fff",
    outline: "none",
  },
  error: {
    marginTop: 10,
    fontSize: 13,
    color: "#ff6b6b",
  },
  button: {
    marginTop: 18,
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 600,
    color: "#0b0c0f",
    background: "var(--accent-brand, #00e676)",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  hint: { marginTop: 16, fontSize: 11, color: "var(--text-faint, #5a5f68)", textAlign: "center" },
};
