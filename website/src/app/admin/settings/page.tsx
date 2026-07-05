"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Role {
  key: string;
  label: string;
  model: string;
  note: string;
}
interface ConfigResp {
  spend_tier: string;
  roles: Role[];
}
interface NicheResp {
  id: string;
  name: string;
  shortName: string;
  accent: string;
  monetization: string;
  sources: { id: string; name: string; color?: string; type: string }[];
}
interface Status {
  openrouter_connected?: boolean;
  fal_connected?: boolean;
  proxy_enabled?: boolean;
  proxy_host?: string | null;
  proxy_port?: string | null;
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: ok ? "var(--accent-brand)" : "var(--text-muted)" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        {ok ? (
          <>
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <circle cx="12" cy="12" r="10" />
        )}
      </svg>
      <span>
        <strong>{label}:</strong> {detail}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [niches, setNiches] = useState<NicheResp[]>([]);
  const [status, setStatus] = useState<Status>({});

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
    fetch("/api/niches").then((r) => r.json()).then((d) => setNiches(d.niches || [])).catch(() => {});
    fetch("/api/settings/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Settings</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Models, niches, and infrastructure for the autonomous engine.
          </span>
        </div>
      </header>

      <div className="main-body" style={{ maxWidth: 760 }}>
        {/* ── AI Models ── */}
        <div className="settings-section">
          <h3>AI models</h3>
          <p>
            The pipeline picks models by <strong>spending tier</strong>. Change the tier on the{" "}
            <Link href="/admin/analytics" style={{ color: "var(--accent-brand)" }}>Analytics</Link> page — these update automatically.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 16px" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Active tier:</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "capitalize",
                padding: "3px 10px",
                borderRadius: 20,
                color: "#00e676",
                background: "rgba(0,230,118,0.1)",
                border: "1px solid rgba(0,230,118,0.25)",
              }}
            >
              {config?.spend_tier ?? "—"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(config?.roles ?? []).map((r) => (
              <div
                key={r.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 14px",
                  background: "var(--bg-primary)",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{r.note}</div>
                </div>
                <code style={{ fontSize: 12, color: "var(--accent-brand)", fontFamily: "var(--font-mono)" }}>{r.model}</code>
              </div>
            ))}
          </div>
        </div>

        {/* ── Niches ── */}
        <div className="settings-section">
          <h3>Niches &amp; sources</h3>
          <p>Each niche is a config file with its own sources, editorial voice, and monetization.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {niches.map((n) => (
              <div key={n.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--bg-primary)" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: n.accent, boxShadow: `0 0 6px ${n.accent}` }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{n.name}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      padding: "2px 8px",
                      borderRadius: 12,
                      color: n.monetization === "affiliate" ? "#f59e0b" : "var(--text-muted)",
                      background: n.monetization === "affiliate" ? "rgba(245,158,11,0.1)" : "var(--bg-elevated)",
                      marginLeft: "auto",
                    }}
                  >
                    {n.monetization === "affiliate" ? "Affiliate" : "No ads"}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 14px" }}>
                  {n.sources.map((s) => (
                    <span
                      key={s.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        padding: "4px 10px",
                        borderRadius: 20,
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color || "#888" }} />
                      {s.name}
                      <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>{s.type}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Infrastructure ── */}
        <div className="settings-section">
          <h3>Infrastructure</h3>
          <p>API keys live in <code style={{ color: "var(--accent-brand)", fontSize: 12 }}>system/.env</code> on the server and are never exposed to the browser.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
            <StatusRow
              ok={!!status.openrouter_connected}
              label="OpenRouter API"
              detail={status.openrouter_connected ? "Connected — writer, rating & research" : "Not configured"}
            />
            <StatusRow
              ok={!!status.fal_connected}
              label="Fal.ai (images)"
              detail={status.fal_connected ? "Connected — Flux Dev" : "Not configured — falling back to OpenRouter DALL·E 3"}
            />
            <StatusRow
              ok={!!status.proxy_enabled}
              label="BrightData proxy"
              detail={
                status.proxy_enabled
                  ? `Residential proxy active (${status.proxy_host}${status.proxy_port ? `:${status.proxy_port}` : ""})`
                  : "Disabled — scraping direct (higher block risk)"
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
