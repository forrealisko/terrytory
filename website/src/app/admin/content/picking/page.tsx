"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SourceArticle {
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  excerpt?: string;
}

interface PickItem {
  id: string;
  created_at: string;
  status: string;
  headline: string;
  rating: number;
  reasoning: string;
  summary: string;
  source_articles: SourceArticle[];
}

export default function PickingQueuePage() {
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [activePickId, setActivePickId] = useState<string | null>(null);
  const [writeOutput, setWriteOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPicks = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content/picks");
      const data = await res.json();
      setPicks(data.picks || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPicks();

    // Check if a background writing process is already active
    const checkInitialStatus = async () => {
      try {
        const res = await fetch("/api/content/generate/status");
        const data = await res.json();
        if (data.running) {
          setWriting(true);
          setWriteOutput(data.logs || "");
        }
      } catch (e) {
        console.error("Error checking initial writer status:", e);
      }
    };

    checkInitialStatus();
  }, []);

  // Poll status when a writing job is active in the background
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const checkStatus = async () => {
      try {
        const res = await fetch("/api/content/generate/status");
        const data = await res.json();
        if (data.logs) {
          setWriteOutput(data.logs);
        }
        if (!data.running) {
          setWriting(false);
          setActivePickId(null);
          fetchPicks(); // Refresh picks queue
        }
      } catch (e) {
        console.error("Error polling writer status:", e);
      }
    };

    if (writing && !activePickId) {
      // Background polling (meaning the user navigated back to this page while it was already running)
      checkStatus();
      intervalId = setInterval(checkStatus, 1500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [writing, activePickId]);

  const handlePickAndWrite = async (pickId: string) => {
    setWriting(true);
    setActivePickId(pickId);
    setWriteOutput("Initializing Perplexity Web Research agent...\n");

    try {
      const res = await fetch("/api/content/picks/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pickId }),
      });

      if (!res.ok) {
        const errText = await res.text();
        setWriteOutput(`❌ Failed to start writing process: ${errText}`);
        setWriting(false);
        setActivePickId(null);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setWriteOutput("❌ Could not read output stream.");
        setWriting(false);
        setActivePickId(null);
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setWriteOutput((prev) => (prev || "") + text);
      }

      // Done
      setWriting(false);
      setActivePickId(null);
      fetchPicks(); // Refresh list
    } catch (err: any) {
      setWriteOutput((prev) => (prev || "") + `\n❌ Network error: ${err.message}`);
      setWriting(false);
      setActivePickId(null);
    }
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 9.0) return "var(--accent-brand)"; // Bright green
    if (rating >= 8.5) return "var(--accent-brand-blue)"; // Cyan blue
    return "var(--text-secondary)";
  };

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Picking Queue</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            Review AI-selected topics rated above 8.0/10 and trigger Perplexity research + Claude article drafting.
          </span>
        </div>
        <div className="main-header-actions" style={{ gap: 12 }}>
          <span
            className="content-badge"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--accent-brand)",
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid rgba(0, 230, 118, 0.2)",
              background: "rgba(0, 230, 118, 0.06)",
            }}
          >
            {picks.length} topics available
          </span>
          <button className="btn btn-secondary" onClick={fetchPicks} disabled={writing}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            Refresh
          </button>
        </div>
      </header>

      <div className="main-body">
        {/* Output console for writing logs */}
        {writeOutput && (
          <div
            className="content-gen-output"
            style={{
              padding: 16,
              background: "var(--bg-card)",
              borderRadius: 10,
              border: "1px solid var(--border-subtle)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              color: "var(--text-secondary)",
              marginBottom: 20,
              maxHeight: 250,
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6 }}>
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {writing ? "⚡ Pick-and-Write Process Running..." : "✓ Process Finished"}
              </span>
              {!writing && (
                <button
                  onClick={() => setWriteOutput(null)}
                  style={{ background: "none", border: "none", color: "var(--accent-rose)", cursor: "pointer", fontSize: 11 }}
                >
                  Dismiss Console
                </button>
              )}
            </div>
            {writeOutput}
          </div>
        )}

        {loading && picks.length === 0 ? (
          <PickingSkeleton />
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <p>Failed to load picks: {error}</p>
          </div>
        ) : picks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📥</div>
            <p>No high-rated topics in the picking queue.</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 500, margin: "8px auto 0" }}>
              Run the scraper from the home page. Scraped articles will be evaluated by the AI Rater, and topics scoring 8.0+ will appear here.
            </p>
          </div>
        ) : (
          <div className="content-drafts-grid">
            {picks.map((pick) => {
              const isProcessingThis = activePickId === pick.id;
              
              return (
                <div key={pick.id} className="content-draft-card" style={{ display: "flex", flexDirection: "column" }}>
                  {/* Header */}
                  <div className="content-draft-card-header" style={{ marginBottom: 12 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: getRatingColor(pick.rating),
                        background: "rgba(11, 12, 15, 0.6)",
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: `1px solid ${getRatingColor(pick.rating)}33`,
                      }}
                    >
                      ★ {pick.rating.toFixed(1)} / 10
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
                      Detected {new Date(pick.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Headline */}
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8, lineHeight: 1.4 }}>
                    {pick.headline}
                  </h3>

                  {/* Summary */}
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
                    {pick.summary}
                  </p>

                  {/* AI Reasoning */}
                  <div
                    style={{
                      background: "rgba(0, 176, 255, 0.03)",
                      borderLeft: "2.5px solid var(--accent-brand-blue)",
                      padding: "8px 12px",
                      borderRadius: "0 6px 6px 0",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      marginBottom: 16,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: 2, fontSize: 11 }}>
                      AI Curation Reasoning:
                    </span>
                    {pick.reasoning}
                  </div>

                  {/* Sources */}
                  <div className="content-draft-sources" style={{ marginTop: "auto", marginBottom: 16 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                      Original Sources:
                    </span>
                    {pick.source_articles.map((src, i) => (
                      <a key={i} href={src.url} target="_blank" rel="noopener noreferrer" className="content-source-link">
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent-brand-blue)", flexShrink: 0 }} />
                        {src.source_name}: {src.title.slice(0, 70)}{src.title.length > 70 ? "…" : ""}
                      </a>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => handlePickAndWrite(pick.id)}
                      disabled={writing}
                      style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}
                    >
                      {isProcessingThis ? (
                        <>
                          <span className="loading-spinner" />
                          Researching &amp; Writing...
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                          Pick &amp; Write Article
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function PickingSkeleton() {
  return (
    <div className="content-drafts-grid">
      {[1, 2].map((i) => (
        <div key={i} className="content-draft-card">
          <div className="loading-skeleton" style={{ width: "25%", height: 16, marginBottom: 16 }} />
          <div className="loading-skeleton" style={{ width: "95%", height: 20, marginBottom: 8 }} />
          <div className="loading-skeleton" style={{ width: "80%", height: 20, marginBottom: 16 }} />
          <div className="loading-skeleton" style={{ width: "100%", height: 60, marginBottom: 16 }} />
          <div className="loading-skeleton" style={{ width: "60%", height: 12, marginBottom: 16 }} />
          <div className="loading-skeleton" style={{ width: "100%", height: 40 }} />
        </div>
      ))}
    </div>
  );
}
