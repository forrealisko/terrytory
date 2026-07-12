"use client";

import { useEffect, useState } from "react";

interface Headline {
  type: string;
  title: string;
  url: string;
  article_date?: string | null;
  article_date_raw?: string | null;
  author?: string | null;
  excerpt?: string | null;
  interest_score?: number;
  is_new: boolean;
  first_seen: string;
  categories?: string[];
  tags?: string[];
  _source_id: string;
  _source_name: string;
  _source_color: string;
  starred?: boolean;
}

interface SourceSummary {
  id: string;
  name: string;
  color: string;
  scraped_at: string | null;
  total_headlines: number;
  error: string | null;
}

interface ScrapeResponse {
  sources: SourceSummary[];
  total: number;
  headlines: Headline[];
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Returns the age in hours of a given date string.
 * Returns Infinity for null/invalid input so those articles are
 * excluded from time-ranged filters.
 */
function getHourDifference(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity;
  try {
    return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
  } catch {
    return Infinity;
  }
}

/**
 * Returns a human-readable relative timestamp for the feed.
 * Fresh articles (< 48h) show "Xh ago", older articles show formatted date.
 */
function getRelativeDisplay(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const diffHours = getHourDifference(dateStr);

  if (diffHours < 1) {
    const mins = Math.max(1, Math.floor(diffHours * 60));
    return `${mins}m ago`;
  }
  if (diffHours < 48) {
    return `${Math.floor(diffHours)}h ago`;
  }

  return formatDate(dateStr);
}

type TimeFilter = "all" | "24h" | "48h" | "72h" | "5d";
type ScoreFilter = "all" | "90-100" | "80-90" | "60-80" | "40-60" | "rest";

const TIME_FILTERS: { id: TimeFilter; label: string; maxHours: number }[] = [
  { id: "all", label: "All", maxHours: Infinity },
  { id: "24h", label: "24h", maxHours: 24 },
  { id: "48h", label: "48h", maxHours: 48 },
  { id: "72h", label: "72h", maxHours: 72 },
  { id: "5d", label: "5 days", maxHours: 120 },
];

const SCORE_FILTERS: { id: ScoreFilter; label: string; min: number; max: number }[] = [
  { id: "all", label: "All", min: -Infinity, max: Infinity },
  { id: "90-100", label: "90–100", min: 90, max: Infinity },
  { id: "80-90", label: "80–90", min: 80, max: 90 },
  { id: "60-80", label: "60–80", min: 60, max: 80 },
  { id: "40-60", label: "40–60", min: 40, max: 60 },
  { id: "rest", label: "Rest", min: -Infinity, max: 40 },
];

export default function DashboardPage() {
  const [data, setData] = useState<ScrapeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeScoreFilter, setActiveScoreFilter] = useState<ScoreFilter>("all");
  const [activeTimeFilter, setActiveTimeFilter] = useState<TimeFilter>("all");
  const [starredUrls, setStarredUrls] = useState<Set<string>>(new Set());

  const [scraping, setScraping] = useState(false);
  const [isStreamingScraper, setIsStreamingScraper] = useState(false);
  const [genOutput, setGenOutput] = useState<string | null>(null);

  const fetchScrapes = () => {
    setLoading(true);
    fetch("/api/scrapes")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  const fetchStarred = () => {
    fetch("/api/scrapes/starred")
      .then((r) => r.json())
      .then((d) => {
        if (d.starred) {
          setStarredUrls(new Set(d.starred));
        }
      })
      .catch((e) => console.error("Error loading stars:", e));
  };

  const toggleStar = async (e: React.MouseEvent, h: Headline) => {
    e.preventDefault();
    e.stopPropagation();

    const isStarred = starredUrls.has(h.url);
    const nextStarred = new Set(starredUrls);
    if (isStarred) {
      nextStarred.delete(h.url);
    } else {
      nextStarred.add(h.url);
    }
    setStarredUrls(nextStarred);

    try {
      const res = await fetch("/api/scrapes/star", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: h.url,
          title: h.title,
          starred: !isStarred,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to star");
      }
    } catch (err) {
      console.error("Star toggle error:", err);
      // revert
      setStarredUrls(starredUrls);
    }
  };

  useEffect(() => {
    fetchScrapes();
    fetchStarred();

    // Check if background scraper is already running on mount
    const checkInitialStatus = async () => {
      try {
        const scrapeRes = await fetch("/api/scrapes/status");
        const scrapeData = await scrapeRes.json();
        if (scrapeData.running) {
          setScraping(true);
          setGenOutput(scrapeData.logs || "");
        }
      } catch (e) {
        console.error("Error checking initial status:", e);
      }
    };

    checkInitialStatus();
  }, []);

  // Poll status when scraper is active and we are not actively streaming it
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
            fetchScrapes(); // Refresh feed when done
          }
        }
      } catch (e) {
        console.error("Error polling status:", e);
      }
    };

    if (scraping && !isStreamingScraper) {
      checkStatus();
      intervalId = setInterval(checkStatus, 1500);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [scraping, isStreamingScraper]);

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
      fetchScrapes(); // Refresh feed
    } catch (err) {
      setGenOutput(
        (prev) => (prev || "") + `\n❌ Network error: ${(err as Error).message}`
      );
    } finally {
      setScraping(false);
      setIsStreamingScraper(false);
    }
  };

  // ── Combined filtering: source × time ────────────────────────────────────
  const filteredHeadlines =
    data?.headlines?.filter((h) => {
      // Score filter — interest_score is 0–100 (may be absent → treated as "rest")
      const scoreDef = SCORE_FILTERS.find((s) => s.id === activeScoreFilter);
      if (scoreDef && activeScoreFilter !== "all") {
        const score = typeof h.interest_score === "number" ? h.interest_score : -1;
        // Upper bound exclusive so buckets don't overlap (e.g. exactly 80 lands in 80–90)
        if (!(score >= scoreDef.min && score < scoreDef.max)) return false;
      }

      // Time filter — use first_seen as the primary timestamp, fall back to article_date
      const compareDate = h.first_seen || h.article_date;
      const ageHours = getHourDifference(compareDate);
      const timeDef = TIME_FILTERS.find((t) => t.id === activeTimeFilter);
      if (timeDef && ageHours > timeDef.maxHours) return false;

      return true;
    }) ?? [];

  return (
    <>
      {/* Body */}
      <div className="main-body" style={{ paddingTop: 24 }}>
        {/* Scraper console output */}
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
          <LoadingSkeleton />
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <p>Failed to load scrape data: {error}</p>
          </div>
        ) : data ? (
          <>
            {/* Feed */}
            <div className="feed-section">
              <div className="feed-section-header">
                <h3>Latest Articles</h3>
              </div>

              {/* Filter row + actions */}
              <div className="filter-row-container">
                {/* Score Selector */}
                <div className="filter-group">
                  <span className="filter-group-label">Score:</span>
                  <div className="feed-filter-tabs">
                    {SCORE_FILTERS.map((s) => (
                      <button
                        key={s.id}
                        className={`feed-filter-tab ${activeScoreFilter === s.id ? "active" : ""}`}
                        onClick={() => setActiveScoreFilter(s.id)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Time Period Selector */}
                <div className="filter-group">
                  <span className="filter-group-label">Timeframe:</span>
                  <div className="feed-filter-tabs">
                    {TIME_FILTERS.map((t) => (
                      <button
                        key={t.id}
                        className={`feed-filter-tab ${activeTimeFilter === t.id ? "active" : ""}`}
                        onClick={() => setActiveTimeFilter(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Actions — pushed to the right */}
                <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleScrapeAndGenerate}
                    disabled={scraping}
                    style={{ opacity: scraping ? 0.6 : 1 }}
                  >
                    {scraping ? (
                      <>
                        <span className="loading-spinner" />
                        Scraping...
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                        </svg>
                        Run Scraper
                      </>
                    )}
                  </button>
                  <button className="btn btn-secondary" onClick={fetchScrapes} disabled={scraping}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 2v6h-6" />
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                      <path d="M3 22v-6h6" />
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                    Refresh
                  </button>
                </div>
              </div>

              {/* Column Headers */}
              <div
                className="article-row"
                style={{
                  padding: "8px 16px",
                  cursor: "default",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <span>Title</span>
                <span>Source</span>
                <span>Date</span>
                <span style={{ textAlign: "center" }}>Star</span>
                <span>Type</span>
              </div>

              {/* Article list */}
              <div className="article-list">
                {filteredHeadlines.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">📡</div>
                    <p>No articles found for this filter.</p>
                  </div>
                ) : (
                  filteredHeadlines.map((h, i) => {
                    const dateField = h.first_seen || h.article_date || h.article_date_raw;
                    const isFresh = getHourDifference(dateField) <= 48;
                    const isStarred = starredUrls.has(h.url);

                    return (
                      <a
                        key={`${h.url}-${i}`}
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`article-row ${isStarred ? "is-starred" : ""}`}
                      >
                        <span className="article-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {typeof h.interest_score === "number" && (
                            <span
                              className="interest-score"
                              title="AI interest score"
                              style={{
                                flexShrink: 0,
                                fontSize: 11,
                                fontWeight: 700,
                                fontVariantNumeric: "tabular-nums",
                                padding: "2px 7px",
                                borderRadius: 6,
                                lineHeight: 1.4,
                                color:
                                  h.interest_score >= 70
                                    ? "#4f8dfd"
                                    : h.interest_score >= 40
                                    ? "#f59e0b"
                                    : "var(--text-muted)",
                                background:
                                  h.interest_score >= 70
                                    ? "rgba(0,230,118,0.10)"
                                    : h.interest_score >= 40
                                    ? "rgba(245,158,11,0.10)"
                                    : "var(--bg-elevated)",
                                border: `1px solid ${
                                  h.interest_score >= 70
                                    ? "rgba(0,230,118,0.25)"
                                    : h.interest_score >= 40
                                    ? "rgba(245,158,11,0.25)"
                                    : "var(--border-subtle)"
                                }`,
                              }}
                            >
                              {h.interest_score}
                            </span>
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</span>
                        </span>
                        <span>
                          <span
                            className="source-badge"
                            style={{
                              color: h._source_color,
                              borderColor: `${h._source_color}33`,
                              background: `${h._source_color}11`,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: h._source_color,
                              }}
                            />
                            {h._source_name}
                          </span>
                        </span>
                        <span className={`article-date ${isFresh ? "text-accent-fresh" : ""}`}>
                          {getRelativeDisplay(dateField)}
                        </span>
                        <span style={{ display: "flex", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                          <button
                            className={`star-btn ${isStarred ? "active" : ""}`}
                            onClick={(e) => toggleStar(e, h)}
                            title={isStarred ? "Starred Pick" : "Star Article"}
                          >
                            {isStarred ? (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                              </svg>
                            ) : (
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                        </span>
                        <span className="article-type-badge">{h.type}</span>
                      </a>
                    );
                  })
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="stats-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="stat-card">
            <div className="loading-skeleton" style={{ width: "60%", height: 12, marginBottom: 12 }} />
            <div className="loading-skeleton" style={{ width: "40%", height: 28, marginBottom: 8 }} />
            <div className="loading-skeleton" style={{ width: "80%", height: 10 }} />
          </div>
        ))}
      </div>
      <div className="feed-section">
        <div className="loading-skeleton" style={{ width: 200, height: 20, marginBottom: 20 }} />
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="loading-skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 10 }} />
        ))}
      </div>
    </>
  );
}
