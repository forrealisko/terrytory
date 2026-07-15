"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/* ── Tabs ─────────────────────────────────────────────────────────── */
const TABS: { id: string; label: string }[] = [
  { id: "general", label: "General" },
  { id: "scraper", label: "Scraper" },
  { id: "studio", label: "Studio" },
  { id: "create", label: "Create" },
  { id: "analytics", label: "Analytics" },
];
const TAB_IDS = TABS.map((t) => t.id);

/* ── Types ───────────────────────────────────────────────────────── */
interface Role {
  key: string;
  label: string;
  model: string;
  note: string;
}
interface TierDef {
  label: string;
  blurb: string;
  writer: string;
  rating: string;
  research: string;
  image: string;
}
interface ConfigResp {
  spend_tier: string;
  roles: Role[];
  tiers: Record<string, TierDef>;
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

/* ── Tier visuals ────────────────────────────────────────────────── */
const TIER_META: Record<string, { icon: string; color: string; glow: string }> = {
  low: { icon: "⚡", color: "#60a5fa", glow: "rgba(96,165,250,0.15)" },
  medium: { icon: "⚖️", color: "#a78bfa", glow: "rgba(167,139,250,0.15)" },
  best: { icon: "🔥", color: "#f59e0b", glow: "rgba(245,158,11,0.15)" },
};

/* ── Helpers ──────────────────────────────────────────────────────── */
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

function modelShort(m: string) {
  // "anthropic/claude-opus-4.8" → "claude-opus-4.8"
  return m.includes("/") ? m.split("/")[1] : m;
}

/* ── Page ─────────────────────────────────────────────────────────── */
export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="main-body" />}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedTab = searchParams.get("tab") || "general";
  const [activeTab, setActiveTab] = useState<string>(
    TAB_IDS.includes(requestedTab) ? requestedTab : "general"
  );

  // Keep the tab in sync when navigating in from another page (URL param changes).
  useEffect(() => {
    if (TAB_IDS.includes(requestedTab)) setActiveTab(requestedTab);
  }, [requestedTab]);

  const selectTab = (id: string) => {
    setActiveTab(id);
    router.replace(`/admin/settings?tab=${id}`);
  };

  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [niches, setNiches] = useState<NicheResp[]>([]);
  const [status, setStatus] = useState<Status>({});
  const [switching, setSwitching] = useState(false);

  const loadConfig = useCallback(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => { });
  }, []);

  useEffect(() => {
    loadConfig();
    fetch("/api/niches").then((r) => r.json()).then((d) => setNiches(d.niches || [])).catch(() => { });
    fetch("/api/settings/status").then((r) => r.json()).then(setStatus).catch(() => { });
  }, [loadConfig]);

  async function handleTierChange(tierKey: string) {
    if (switching || tierKey === config?.spend_tier) return;
    setSwitching(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spend_tier: tierKey }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch { /* swallow */ }
    setSwitching(false);
  }

  const tierKeys = config ? Object.keys(config.tiers) : [];

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
        {/* ── Tab strip ── */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 24,
            borderBottom: "1px solid var(--border-subtle)",
            paddingBottom: 12,
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={`feed-filter-tab ${activeTab === t.id ? "active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab !== "general" ? (
          <div
            className="settings-section"
            style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚙️</div>
            <p style={{ fontSize: 14, marginBottom: 6 }}>
              No {TABS.find((t) => t.id === activeTab)?.label}-specific settings yet.
            </p>
            <p style={{ fontSize: 12 }}>
              Global configuration lives under{" "}
              <button
                onClick={() => selectTab("general")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-brand)",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                General
              </button>
              .
            </p>
          </div>
        ) : (
          <>
        {/* ── Spend Tier Selector ── */}
        <div className="settings-section">
          <h3>AI spending tier</h3>
          <p>Choose which models run across the entire pipeline. Changes take effect immediately.</p>

          <div style={{ display: "grid", gridTemplateColumns: `repeat(${tierKeys.length}, 1fr)`, gap: 12, margin: "16px 0" }}>
            {tierKeys.map((key) => {
              const tier = config!.tiers[key];
              const meta = TIER_META[key] || TIER_META.medium;
              const active = config?.spend_tier === key;
              return (
                <button
                  key={key}
                  onClick={() => handleTierChange(key)}
                  disabled={switching}
                  style={{
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 6,
                    padding: "16px 18px",
                    background: active ? meta.glow : "var(--bg-primary)",
                    border: active ? `2px solid ${meta.color}` : "1px solid var(--border-subtle)",
                    borderRadius: 12,
                    cursor: switching ? "wait" : "pointer",
                    transition: "all 0.2s ease",
                    textAlign: "left",
                    color: "inherit",
                    fontFamily: "inherit",
                  }}
                >
                  {active && (
                    <span style={{
                      position: "absolute",
                      top: 10,
                      right: 12,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: meta.color,
                    }}>
                      Active
                    </span>
                  )}
                  <span style={{ fontSize: 22 }}>{meta.icon}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, textTransform: "capitalize" }}>{tier.label || key}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{tier.blurb}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Active Models ── */}
        <div className="settings-section">
          <h3>Active models</h3>
          <p>These are resolved from the <strong>{config?.spend_tier ?? "—"}</strong> tier and used by every pipeline step.</p>

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
                <code style={{ fontSize: 12, color: "var(--accent-brand)", fontFamily: "var(--font-mono)" }}>{modelShort(r.model)}</code>
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
          </>
        )}
      </div>
    </>
  );
}
