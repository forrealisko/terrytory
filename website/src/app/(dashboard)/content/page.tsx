"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SourceRef {
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  excerpt?: string;
}

interface Draft {
  id: string;
  created_at: string;
  status: string;
  source_articles: SourceRef[];
  headline_options: string[];
  slug: string;
  body_markdown: string;
  excerpt: string;
  seo: {
    meta_title: string;
    meta_description: string;
    keywords: string[];
  };
  hero_image_prompt?: string;
  generation: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    generation_time_ms: number;
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function wordCount(text: string): number {
  return text
    .replace(/[#*_\[\]()>`-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export default function ContentQueuePage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [isStreamingScraper, setIsStreamingScraper] = useState(false);
  const [isStreamingGenerator, setIsStreamingGenerator] = useState(false);
  const [genOutput, setGenOutput] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("terrytory_genOutput");
    }
    return null;
  });
  const [error, setError] = useState<string | null>(null);

  // Persist genOutput to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (genOutput) {
        sessionStorage.setItem("terrytory_genOutput", genOutput);
      } else {
        sessionStorage.removeItem("terrytory_genOutput");
      }
    }
  }, [genOutput]);

  const fetchDrafts = () => {
    setLoading(true);
    fetch("/api/content/drafts")
      .then((r) => r.json())
      .then((d) => {
        setDrafts(d.drafts || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDrafts();

    // Check if background processes are already running on mount
    const checkInitialStatus = async () => {
      try {
        const scrapeRes = await fetch("/api/scrapes/status");
        const scrapeData = await scrapeRes.json();
        if (scrapeData.running) {
          setScraping(true);
          setGenOutput(scrapeData.logs || "");
        }

        const genRes = await fetch("/api/content/generate/status");
        const genData = await genRes.json();
        if (genData.running) {
          setGenerating(true);
          setGenOutput(genData.logs || "");
        }
      } catch (e) {
        console.error("Error checking initial status:", e);
      }
    };

    checkInitialStatus();
  }, []);

  // Poll status when scraping or generating is active and we are not actively streaming it
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const checkStatus = async () => {
      try {
        if (scraping && !isStreamingScraper) {
          const res = await fetch("/api/scrapes/status");
          const data = await res.json();
          if (data.logs) {
            setGenOutput(data.logs);
          }
          if (!data.running) {
            setScraping(false);
            fetchDrafts();
          }
        } else if (generating && !isStreamingGenerator) {
          const res = await fetch("/api/content/generate/status");
          const data = await res.json();
          if (data.logs) {
            setGenOutput(data.logs);
          }
          if (!data.running) {
            setGenerating(false);
            fetchDrafts();
          }
        }
      } catch (e) {
        console.error("Error polling status:", e);
      }
    };

    if ((scraping && !isStreamingScraper) || (generating && !isStreamingGenerator)) {
      checkStatus();
      intervalId = setInterval(checkStatus, 1500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [scraping, generating, isStreamingScraper, isStreamingGenerator]);

  const handleGenerate = async () => {
    setGenerating(true);
    setIsStreamingGenerator(true);
    setGenOutput("");
    try {
      const res = await fetch("/api/content/generate", { method: "POST" });
      if (!res.ok) {
        const errText = await res.text();
        setGenOutput(`❌ Failed to start generation: ${errText}`);
        setGenerating(false);
        setIsStreamingGenerator(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setGenOutput("❌ Could not read output stream.");
        setGenerating(false);
        setIsStreamingGenerator(false);
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setGenOutput((prev) => (prev || "") + text);
      }
      fetchDrafts(); // Refresh list
    } catch (err) {
      setGenOutput(
        (prev) => (prev || "") + `\n❌ Network error: ${(err as Error).message}`
      );
    } finally {
      setGenerating(false);
      setIsStreamingGenerator(false);
    }
  };

  const handleScrapeAndGenerate = async () => {
    setScraping(true);
    setIsStreamingScraper(true);
    setGenOutput("");
    try {
      const res = await fetch("/api/scrapes", { method: "POST" });
      if (!res.ok) {
        const errText = await res.text();
        setGenOutput(`❌ Failed to start scraping: ${errText}`);
        setScraping(false);
        setIsStreamingScraper(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setGenOutput("❌ Could not read output stream.");
        setScraping(false);
        setIsStreamingScraper(false);
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setGenOutput((prev) => (prev || "") + text);
      }
      fetchDrafts(); // Refresh list
    } catch (err) {
      setGenOutput(
        (prev) => (prev || "") + `\n❌ Network error: ${(err as Error).message}`
      );
    } finally {
      setScraping(false);
      setIsStreamingScraper(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Reject this draft? It will be archived.")) return;
    try {
      await fetch(`/api/content/drafts/${id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // silently fail
    }
  };

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Create</h2>
          <span
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
          >
            Review AI-generated articles before publishing
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
            {drafts.length} pending
          </span>
          <button
            className="btn btn-secondary"
            onClick={handleScrapeAndGenerate}
            disabled={scraping || generating}
            style={{ opacity: scraping ? 0.6 : 1 }}
          >
            {scraping ? (
              <>
                <span className="loading-spinner" />
                Scraping...
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                Run Scraper
              </>
            )}
          </button>
          <button className="btn btn-secondary" onClick={fetchDrafts}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            Refresh
          </button>
          
          <Link href="/settings" className="btn btn-secondary" style={{ padding: "8px" }} title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="16" height="16">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="main-body">
        {/* Generator output */}
        {genOutput && (
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
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {genOutput}
            <button
              onClick={() => setGenOutput(null)}
              style={{
                display: "block",
                marginTop: 8,
                fontSize: 11,
                color: "var(--text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <QueueSkeleton />
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <p>Failed to load drafts: {error}</p>
          </div>
        ) : drafts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <p>No drafts awaiting review.</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 500, margin: "8px auto 0" }}>
              Go to the &quot;Picking Queue&quot; to pick topics and write new drafts,
              or wait for the next automated scrape cycle.
            </p>
          </div>
        ) : (
          <div className="content-drafts-grid">
            {drafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onReject={() => handleReject(draft.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function DraftCard({
  draft,
  onReject,
}: {
  draft: Draft;
  onReject: () => void;
}) {
  const words = wordCount(draft.body_markdown);
  const readTime = Math.max(1, Math.ceil(words / 250));

  return (
    <div className="content-draft-card">
      {/* Header */}
      <div className="content-draft-card-header">
        <span className="content-draft-badge">DRAFT</span>
        <span
          style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}
        >
          {timeAgo(draft.created_at)}
        </span>
      </div>

      {/* Headline Options */}
      <div className="content-headlines">
        {draft.headline_options.map((headline, i) => (
          <div key={i} className="content-headline-option">
            <span className="content-headline-number">{i + 1}</span>
            <span className="content-headline-text">{headline}</span>
          </div>
        ))}
      </div>

      {/* Excerpt */}
      <p className="content-draft-excerpt">{draft.excerpt}</p>

      {/* Meta */}
      <div className="content-draft-meta">
        <span>
          {words.toLocaleString()} words · {readTime} min read
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 4,
            background: "var(--bg-elevated)",
            color: "var(--text-muted)",
          }}
        >
          {draft.generation.model.split("/").pop()}
        </span>
      </div>

      {/* Source Articles */}
      <div className="content-draft-sources">
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
          }}
        >
          Based on:
        </span>
        {draft.source_articles.map((src, i) => (
          <a
            key={i}
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="content-source-link"
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--accent-brand-blue)",
                flexShrink: 0,
              }}
            />
            {src.source_name}: {src.title.slice(0, 60)}
            {src.title.length > 60 ? "…" : ""}
          </a>
        ))}
      </div>

      {/* Actions */}
      <div className="content-draft-actions">
        <Link
          href={`/content/review/${draft.id}`}
          className="btn btn-primary"
          style={{ flex: 1, textAlign: "center", textDecoration: "none" }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Review &amp; Edit
        </Link>
        <button
          className="btn btn-secondary"
          onClick={onReject}
          style={{
            color: "var(--accent-rose)",
            borderColor: "rgba(244, 63, 94, 0.2)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Reject
        </button>
      </div>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="content-drafts-grid">
      {[1, 2, 3].map((i) => (
        <div key={i} className="content-draft-card">
          <div
            className="loading-skeleton"
            style={{ width: "30%", height: 16, marginBottom: 16 }}
          />
          <div
            className="loading-skeleton"
            style={{ width: "90%", height: 18, marginBottom: 8 }}
          />
          <div
            className="loading-skeleton"
            style={{ width: "85%", height: 18, marginBottom: 8 }}
          />
          <div
            className="loading-skeleton"
            style={{ width: "75%", height: 18, marginBottom: 16 }}
          />
          <div
            className="loading-skeleton"
            style={{ width: "100%", height: 40, marginBottom: 12 }}
          />
          <div
            className="loading-skeleton"
            style={{ width: "60%", height: 12 }}
          />
        </div>
      ))}
    </div>
  );
}
