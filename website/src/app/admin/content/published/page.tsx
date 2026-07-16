"use client";

/**
 * Published — the articles that are actually live, and the ones pulled back.
 *
 * This screen used to list *shipped* articles (staged, not yet live), which left
 * the 14 genuinely-published ones with no UI at all. Now it manages what the
 * public can see: feature one for the hub, archive it, or edit it after the fact.
 *
 * On Vercel each action is a commit, so the site takes a deploy (~1-2 min) to
 * catch up. The row updates immediately and says "publishing…" until then —
 * waiting on a redeploy to redraw a toggle would make this miserable to use.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Article {
  id: string;
  slug: string;
  published_slug?: string;
  headline?: string;
  selected_headline?: string;
  excerpt?: string;
  published_at?: string;
  archived_at?: string;
  featured?: boolean;
  format?: string;
  seo?: { meta_title?: string };
}

type Tab = "live" | "archived";

function title(a: Article) {
  return a.selected_headline || a.headline || a.seo?.meta_title || "Untitled";
}

function slugOf(a: Article) {
  return a.published_slug || a.slug;
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "—";
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function PublishedPage() {
  const [tab, setTab] = useState<Tab>("live");
  const [live, setLive] = useState<Article[]>([]);
  const [archived, setArchived] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([
        fetch("/api/content/published?limit=200").then((r) => r.json()),
        fetch("/api/content/archived").then((r) => r.json()),
      ]);
      setLive(p.articles || []);
      setArchived(a.articles || []);
    } catch {
      setError("Couldn't load articles.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(slug: string, run: () => Promise<Response>, optimistic: () => void) {
    setBusy(slug);
    setError(null);
    optimistic();
    try {
      const res = await run();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Failed (${res.status})`);
        await load(); // our optimistic guess was wrong — go get the truth
      } else if (body.pending) {
        setPending(true);
      }
    } catch (e) {
      setError((e as Error).message);
      await load();
    }
    setBusy(null);
  }

  const toggleFeature = (a: Article) => {
    const slug = slugOf(a);
    act(
      slug,
      () =>
        fetch(`/api/content/published/${slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ featured: !a.featured }),
        }),
      () => setLive((xs) => xs.map((x) => (slugOf(x) === slug ? { ...x, featured: !a.featured } : x)))
    );
  };

  const archive = (a: Article) => {
    const slug = slugOf(a);
    if (!confirm(`Take "${title(a)}" off the live site?\n\nIt moves to Archived — you can put it back.`)) return;
    act(
      slug,
      () => fetch(`/api/content/published/${slug}`, { method: "DELETE" }),
      () => {
        setLive((xs) => xs.filter((x) => slugOf(x) !== slug));
        setArchived((xs) => [{ ...a, featured: false, archived_at: new Date().toISOString() }, ...xs]);
      }
    );
  };

  const restore = (a: Article) => {
    const slug = slugOf(a);
    act(
      slug,
      () =>
        fetch("/api/content/archived", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        }),
      () => {
        setArchived((xs) => xs.filter((x) => slugOf(x) !== slug));
        setLive((xs) => [a, ...xs]);
      }
    );
  };

  const rows = tab === "live" ? live : archived;
  const featuredCount = live.filter((a) => a.featured).length;

  return (
    <>
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2>Published</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {live.length} live · {featuredCount} featured on the hub · {archived.length} archived
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={tab === "live" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("live")}>
            Live ({live.length})
          </button>
          <button className={tab === "archived" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("archived")}>
            Archived ({archived.length})
          </button>
        </div>
      </header>

      <div className="main-body">
        {pending && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 10,
              borderRadius: 8,
              fontSize: 12,
              background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.25)",
            }}
          >
            Saved to the repo. The live site updates on the next deploy — usually a minute or two.
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 10,
              borderRadius: 8,
              fontSize: 12,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="feed-section">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="loading-skeleton" style={{ height: 56, marginBottom: 4, borderRadius: 10 }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">{tab === "live" ? "📰" : "🗄️"}</div>
            <p>{tab === "live" ? "Nothing published yet." : "Nothing archived."}</p>
            {tab === "live" && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Schedule something from{" "}
                <Link href="/admin/content" style={{ color: "var(--accent-brand)" }}>
                  Create
                </Link>{" "}
                and it shows up here once it goes live.
              </p>
            )}
          </div>
        ) : (
          <div className="feed-section">
            <div className="article-list">
              {rows.map((a) => {
                const slug = slugOf(a);
                const working = busy === slug;
                return (
                  <div key={a.id || slug} className="published-row" style={{ opacity: working ? 0.5 : 1 }}>
                    {tab === "live" && (
                      <button
                        className="published-star"
                        onClick={() => toggleFeature(a)}
                        disabled={working}
                        title={a.featured ? "Featured on the hub — click to remove" : "Feature on the hub"}
                        style={{ color: a.featured ? "#f5a623" : "var(--text-muted)" }}
                      >
                        {a.featured ? "★" : "☆"}
                      </button>
                    )}

                    <span className="published-title" title={title(a)}>
                      {title(a)}
                    </span>

                    <span className="published-date">
                      {timeAgo(tab === "live" ? a.published_at : a.archived_at)}
                    </span>

                    {tab === "live" ? (
                      <>
                        <Link
                          href={`/admin/content/review/${a.id}`}
                          className="source-badge"
                          style={{ textDecoration: "none", whiteSpace: "nowrap" }}
                        >
                          Edit
                        </Link>
                        <button className="btn-secondary" disabled={working} onClick={() => archive(a)}>
                          Archive
                        </button>
                      </>
                    ) : (
                      <button className="btn-secondary" disabled={working} onClick={() => restore(a)}>
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
