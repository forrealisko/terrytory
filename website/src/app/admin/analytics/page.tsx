"use client";

import { useEffect, useState } from "react";
import { PipelineBoard } from "@/components/PipelineBoard";

interface Analytics {
  niche: string;
  scraped: { today: number; total: number };
  drafts: number;
  published: { today: number; total: number };
  spend: { total: number; today: number; tokens: { input: number; output: number }; images: number };
  sources: { id: string; name: string; color: string; total: number; scraped_at: string | null }[];
}

type Tier = "low" | "medium" | "best";
const TIERS: { key: Tier; label: string; blurb: string }[] = [
  { key: "low", label: "Low", blurb: "Cheapest models — fast & economical" },
  { key: "medium", label: "Medium", blurb: "Balanced quality and cost" },
  { key: "best", label: "Best", blurb: "Top models for the job — highest quality" },
];

function timeAgo(iso: string | null): string {
  if (!iso) return "no data";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SpendSlider() {
  const [tier, setTier] = useState<Tier>("medium");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => d.spend_tier && setTier(d.spend_tier))
      .catch(() => {});
  }, []);

  const pick = async (t: Tier) => {
    setTier(t);
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spend_tier: t }),
      });
    } finally {
      setSaving(false);
    }
  };

  const idx = TIERS.findIndex((t) => t.key === tier);

  return (
    <div className="analytics-card" style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>AI spending preset</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{saving ? "saving…" : `${TIERS[idx].label} selected`}</span>
      </div>

      <div className="spend-slider">
        <div className="spend-slider-track">
          <div className="spend-slider-fill" style={{ width: `${(idx / (TIERS.length - 1)) * 100}%` }} />
        </div>
        <div className="spend-slider-stops">
          {TIERS.map((t, i) => (
            <button
              key={t.key}
              className={`spend-stop ${i <= idx ? "reached" : ""} ${i === idx ? "active" : ""}`}
              onClick={() => pick(t.key)}
            >
              <span className="spend-stop-dot" />
              <span className="spend-stop-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 14, marginBottom: 0 }}>
        {TIERS[idx].blurb}
      </p>
    </div>
  );
}

export default function AnalyticsPage() {
  const [a, setA] = useState<Analytics | null>(null);
  const [scheduler, setScheduler] = useState<any>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/analytics").then((r) => r.json()).then(setA).catch(() => {});
      fetch("/api/scheduler").then((r) => r.json()).then(setScheduler).catch(() => {});
    };
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, []);

  const metrics = a
    ? [
        { label: "Scraped today", value: a.scraped.today, sub: `${a.scraped.total.toLocaleString()} total`, color: "#00b0ff" },
        { label: "In review", value: a.drafts, sub: "drafts awaiting edit", color: "#a78bfa" },
        { label: "Published today", value: a.published.today, sub: `${a.published.total} total live`, color: "#00e676" },
        { label: "AI spend", value: `$${a.spend.total.toFixed(2)}`, sub: `$${a.spend.today.toFixed(2)} today · est.`, color: "#f59e0b" },
      ]
    : [];

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Analytics</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Pipeline health, throughput, and AI spend for the active niche.
          </span>
        </div>
      </header>

      <div className="main-body">
        {/* Top metrics */}
        <div className="analytics-metrics">
          {metrics.length === 0
            ? [0, 1, 2, 3].map((i) => <div key={i} className="loading-skeleton" style={{ height: 92, borderRadius: 14 }} />)
            : metrics.map((m) => (
                <div key={m.label} className="analytics-metric">
                  <div className="analytics-metric-label">{m.label}</div>
                  <div className="analytics-metric-value" style={{ color: m.color }}>{m.value}</div>
                  <div className="analytics-metric-sub">{m.sub}</div>
                </div>
              ))}
        </div>

        {/* Spend preset slider */}
        <SpendSlider />

        {/* Pipeline (moved from Scraper page) */}
        <PipelineBoard />

        {/* Scheduler status (moved from Scraper page) */}
        {scheduler && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              background: scheduler.active ? "rgba(0, 230, 118, 0.02)" : "rgba(255, 23, 68, 0.02)",
              border: `1px solid ${scheduler.active ? "rgba(0, 230, 118, 0.15)" : "rgba(255, 23, 68, 0.15)"}`,
              borderRadius: 10,
              fontSize: 12.5,
              marginBottom: 20,
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: scheduler.active ? "#00e676" : "#ff1744",
                boxShadow: `0 0 6px ${scheduler.active ? "#00e676" : "#ff1744"}`,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, color: scheduler.active ? "#00e676" : "#ff1744" }}>
                Scheduler Daemon {scheduler.active ? "Active" : "Inactive"}
              </span>
              {scheduler.active && ` (PID: ${scheduler.pid})`}
              {" | "}
              <strong>Next Scrape:</strong> {scheduler.schedule?.morningScrape} / {scheduler.schedule?.eveningScrape}
              {" | "}
              <strong>Next Gen &amp; Post:</strong> {scheduler.schedule?.noonCycle} / {scheduler.schedule?.midnightCycle}
            </div>
            {scheduler.heartbeat && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                Vitals OK ({new Date(scheduler.heartbeat).toLocaleTimeString()})
              </span>
            )}
          </div>
        )}

        {/* Source breakdown (moved from Scraper page) */}
        {a && (
          <>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: "4px 0 12px", color: "var(--text-primary)" }}>
              Sources — {a.sources.length} feeds
            </h3>
            <div className="stats-grid">
              {a.sources.map((src) => (
                <div key={src.id} className="stat-card">
                  <div className="stat-card-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: src.color, display: "inline-block" }} />
                    {src.name}
                  </div>
                  <div className="stat-card-value">{src.total}</div>
                  <div className="stat-card-sub">Scraped {timeAgo(src.scraped_at)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
