"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";

const NAV_ITEMS = [
  {
    href: "/admin",
    label: "SCRAPER",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/admin/studio",
    label: "STUDIO",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M12 2l2.4 6.9H22l-6 4.5 2.3 7-6.3-4.6L5.7 20l2.3-7-6-4.5h7.6z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/admin/content",
    label: "CREATE",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    href: "/admin/content/published",
    label: "PUBLISHED",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    href: "/admin/analytics",
    label: "ANALYTICS",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
        <line x1="18" y1="20" x2="18" y2="10" strokeLinecap="round" />
        <line x1="12" y1="20" x2="12" y2="4" strokeLinecap="round" />
        <line x1="6" y1="20" x2="6" y2="14" strokeLinecap="round" />
      </svg>
    ),
  },
];

interface NicheInfo {
  id: string;
  name: string;
  shortName: string;
  accent: string;
}

// Map the current admin page to the Settings tab we should open on.
function sectionForPathname(pathname: string): string {
  if (pathname.startsWith("/admin/studio")) return "studio";
  if (pathname.startsWith("/admin/content")) return "create";
  if (pathname.startsWith("/admin/analytics")) return "analytics";
  if (pathname === "/admin") return "scraper";
  return "general";
}

export function Sidebar() {
  const pathname = usePathname();
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [slateCount, setSlateCount] = useState<number | null>(null);
  const [niches, setNiches] = useState<NicheInfo[]>([]);
  const [activeNiche, setActiveNiche] = useState<string>("ai");
  const [vacation, setVacation] = useState<boolean | null>(null);
  const [canSave, setCanSave] = useState(true);
  const [savingVacation, setSavingVacation] = useState(false);
  const [vacationError, setVacationError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/niches")
      .then((r) => r.json())
      .then((d) => {
        if (d.niches) setNiches(d.niches);
        if (d.active) setActiveNiche(d.active);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setVacation(!!d.vacation);
        setCanSave(d.can_save !== false);
      })
      .catch(() => {});
  }, []);

  const toggleVacation = async () => {
    const next = !vacation;
    setSavingVacation(true);
    setVacationError(null);
    setVacation(next); // optimistic — the toggle should feel instant
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vacation: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVacation(!next); // it didn't land — don't leave the UI lying about it
        setVacationError(body.error || `Couldn't save (${res.status})`);
      }
    } catch (e) {
      setVacation(!next);
      setVacationError((e as Error).message);
    }
    setSavingVacation(false);
  };

  const switchNiche = (id: string) => {
    if (id === activeNiche) return;
    document.cookie = `niche=${id}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  useEffect(() => {
    async function fetchCount() {
      try {
        const res = await fetch("/api/content/drafts");
        if (res.ok) {
          const data = await res.json();
          setDraftCount(data.total ?? data.drafts?.length ?? 0);
        }
      } catch {
        // silently ignore
      }
    }
    async function fetchSlate() {
      try {
        const res = await fetch("/api/content/ideas");
        if (res.ok) {
          const data = await res.json();
          const proposed = (data.slate ?? []).filter(
            (i: { status: string }) => i.status === "proposed"
          ).length;
          setSlateCount(proposed);
        }
      } catch {
        // silently ignore
      }
    }
    fetchCount();
    fetchSlate();

    // Poll occasionally (every 30 seconds)
    const interval = setInterval(() => {
      fetchCount();
      fetchSlate();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandMark size={28} />
        <h1 className="brand-title-powerful">TERRYTORY</h1>
      </div>

      {niches.length > 1 && (
        <div style={{ padding: "12px 12px 16px", display: "flex", flexDirection: "row", gap: 6 }}>
          {niches.map((n) => {
            const isActive = n.id === activeNiche;
            return (
              <button
                key={n.id}
                onClick={() => switchNiche(n.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                  border: `1px solid ${isActive ? `${n.accent}44` : "var(--border-subtle)"}`,
                  background: isActive ? `${n.accent}14` : "transparent",
                  color: isActive ? n.accent : "var(--text-secondary)",
                  textAlign: "center",
                  flex: 1,
                  minWidth: 0,
                  transition: "all 0.15s ease",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: n.accent,
                    opacity: isActive ? 1 : 0.35,
                    boxShadow: isActive ? `0 0 6px ${n.accent}` : "none",
                    flexShrink: 0,
                  }}
                />
                {n.shortName}
              </button>
            );
          })}
        </div>
      )}

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link ${pathname === item.href ? "active" : ""}`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.href === "/admin/content" && draftCount !== null && draftCount > 0 && (
              <span
                style={{
                  background: "var(--accent-fresh, #4f8dfd)",
                  color: "#0b0c0f",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 10,
                  minWidth: 16,
                  textAlign: "center",
                  lineHeight: 1,
                  marginLeft: "auto",
                }}
              >
                {draftCount}
              </span>
            )}
            {item.href === "/admin/studio" && slateCount !== null && slateCount > 0 && (
              <span
                title={`${slateCount} idea${slateCount === 1 ? "" : "s"} waiting in today's slate`}
                style={{
                  background: "#8b5cf6",
                  color: "#0b0c0f",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: 10,
                  minWidth: 16,
                  textAlign: "center",
                  lineHeight: 1,
                  marginLeft: "auto",
                }}
              >
                {slateCount}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <Link
          href={`/admin/settings?tab=${sectionForPathname(pathname)}`}
          className={`sidebar-link ${pathname.startsWith("/admin/settings") ? "active" : ""}`}
          style={{ marginBottom: 10 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>SETTINGS</span>
        </Link>
        {/* Was a hardcoded "Scrapers active" that never checked anything. Now it
            reports the real state and is the switch: the daily scrape is the one
            automated job that spends money, and this is what stops it. */}
        <button
          type="button"
          className={`sidebar-status sidebar-vacation${vacation ? " on" : ""}`}
          onClick={toggleVacation}
          disabled={savingVacation || vacation === null || !canSave}
          title={
            !canSave
              ? "This deployment can't save settings — set GITHUB_TOKEN, or toggle it locally and push."
              : vacation
                ? "Automation is frozen. Click to resume the daily scrape."
                : "Click to freeze the daily scrape — no rating, no spend."
          }
        >
          <div className="sidebar-status-dot" />
          <span>
            {vacation === null
              ? "Checking…"
              : vacation
                ? "🏖 Vacation — automation off"
                : "Scrapers active"}
          </span>
        </button>
        {vacationError && (
          <div style={{ fontSize: 10, color: "#ef4444", padding: "4px 10px 0", lineHeight: 1.4 }}>
            {vacationError}
          </div>
        )}
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
            window.location.href = "/login";
          }}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "7px 10px",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-muted)",
            background: "transparent",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
