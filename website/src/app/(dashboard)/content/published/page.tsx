"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ShippedArticle {
  folder_name: string;
  headline: string;
  slug: string;
  shipped_at: string;
  created_at: string;
  generation: { model: string };
  source_articles: Array<{ source_name: string; title: string; url: string }>;
  seo: { meta_title: string; keywords: string[] };
  hero_image_url?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export default function PublishedPage() {
  const [articles, setArticles] = useState<ShippedArticle[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/content/shipped")
      .then((r) => r.json())
      .then((d) => {
        setArticles(d.articles || []);
        setTotal(d.total || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Published</h2>
          <span
            style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
          >
            {total} shipped article{total !== 1 ? "s" : ""} ready for publishing
          </span>
        </div>
        <div className="main-header-actions">
          <Link href="/settings" className="btn btn-secondary" style={{ padding: "8px" }} title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="16" height="16">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Link>
        </div>
      </header>

      <div className="main-body">
        {loading ? (
          <div className="feed-section">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="loading-skeleton"
                style={{ height: 56, marginBottom: 4, borderRadius: 10 }}
              />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚀</div>
            <p>No shipped articles yet.</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Ship articles from the{" "}
              <Link href="/content" style={{ color: "var(--accent-brand)" }}>
                Create
              </Link>{" "}
              page to see them here.
            </p>
          </div>
        ) : (
          <div className="feed-section">
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
              <span>Shipped</span>
              <span>Model</span>
              <span></span>
            </div>

            <div className="article-list">
              {articles.map((a) => (
                <Link
                  key={a.folder_name}
                  href={`/content/editor/${a.folder_name}`}
                  className="article-row"
                  style={{ textDecoration: "none", cursor: "pointer" }}
                >
                  <span className="article-title">
                    {a.headline || a.seo?.meta_title || "Untitled"}
                  </span>
                  <span className="article-date">
                    {timeAgo(a.shipped_at)}
                    <span
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginTop: 1,
                      }}
                    >
                      {formatDate(a.shipped_at)}
                    </span>
                  </span>
                  <span
                    className="article-type-badge"
                    style={{ fontSize: 10 }}
                  >
                    {a.generation?.model?.split("/").pop() || "unknown"}
                  </span>
                  <span
                    className="source-badge"
                    style={{
                      color: "var(--accent-brand)",
                      borderColor: "rgba(0, 230, 118, 0.2)",
                      background: "rgba(0, 230, 118, 0.06)",
                    }}
                  >
                    Open Editor →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
