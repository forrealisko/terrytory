"use client";

/**
 * Admin top navigation.
 *
 * Replaces the old fixed left sidebar. On a wide screen that rail cost ~260px
 * of horizontal space permanently while its lower half sat empty — content is
 * wide (article editor, idea grids, dashboards) and benefits far more from the
 * width than navigation ever did. A horizontal bar also reads like a product
 * rather than a browser chrome panel.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./BrandMark";

const NAV_ITEMS = [
  { href: "/admin", label: "Scraper" },
  { href: "/admin/studio", label: "Studio", badge: "slate" as const },
  { href: "/admin/content", label: "Create", badge: "drafts" as const },
  { href: "/admin/content/published", label: "Published" },
  { href: "/admin/analytics", label: "Analytics" },
];

interface NicheInfo {
  id: string;
  brand?: { shortName?: string; accent?: string };
}

/** Longest matching href wins, so /admin doesn't light up on every page. */
function isActive(pathname: string, href: string, all: string[]) {
  const matches = all.filter((h) => pathname === h || pathname.startsWith(h + "/"));
  if (!matches.length) return href === "/admin" && pathname === "/admin";
  return matches.sort((a, b) => b.length - a.length)[0] === href;
}

function sectionForPathname(p: string) {
  if (p.startsWith("/admin/studio")) return "studio";
  if (p.startsWith("/admin/content")) return "create";
  if (p.startsWith("/admin/analytics")) return "analytics";
  return "scraper";
}

export function TopNav() {
  const pathname = usePathname();
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [slateCount, setSlateCount] = useState<number | null>(null);
  const [niches, setNiches] = useState<NicheInfo[]>([]);
  const [activeNiche, setActiveNiche] = useState<string>("ai");
  const [vacation, setVacation] = useState<boolean | null>(null);
  const [canSave, setCanSave] = useState(true);
  const [savingVacation, setSavingVacation] = useState(false);

  const hrefs = NAV_ITEMS.map((i) => i.href);

  useEffect(() => {
    fetch("/api/niches")
      .then((r) => r.json())
      .then((d) => {
        if (d.niches) setNiches(d.niches);
        if (d.active) setActiveNiche(d.active);
      })
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setVacation(!!d.vacation);
        setCanSave(d.can_save !== false);
      })
      .catch(() => {});
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const [d, i] = await Promise.all([
        fetch("/api/content/drafts").then((r) => r.json()),
        fetch("/api/content/ideas").then((r) => r.json()),
      ]);
      setDraftCount(d.total ?? d.drafts?.length ?? 0);
      setSlateCount((i.slate ?? []).filter((x: { status: string }) => x.status === "proposed").length);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCounts();
    const iv = setInterval(loadCounts, 30000);
    return () => clearInterval(iv);
  }, [loadCounts]);

  const switchNiche = (id: string) => {
    if (id === activeNiche) return;
    document.cookie = `niche=${id}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  const toggleVacation = async () => {
    const next = !vacation;
    setSavingVacation(true);
    setVacation(next);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vacation: next }),
      });
      if (!res.ok) setVacation(!next);
    } catch {
      setVacation(!next);
    }
    setSavingVacation(false);
  };

  const badgeFor = (b?: "slate" | "drafts") =>
    b === "slate" ? slateCount : b === "drafts" ? draftCount : null;

  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link href="/admin" className="topnav-brand">
          <BrandMark size={26} />
          <span>TERRYTORY</span>
        </Link>

        {niches.length > 1 && (
          <div className="topnav-niches">
            {niches.map((n) => (
              <button
                key={n.id}
                onClick={() => switchNiche(n.id)}
                className={`topnav-niche${n.id === activeNiche ? " active" : ""}`}
                style={{ "--niche": n.brand?.accent || "var(--accent-brand)" } as React.CSSProperties}
              >
                <span className="topnav-niche-dot" />
                {n.brand?.shortName || n.id.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        <nav className="topnav-links">
          {NAV_ITEMS.map((item) => {
            const count = badgeFor(item.badge);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`topnav-link${isActive(pathname, item.href, hrefs) ? " active" : ""}`}
              >
                {item.label}
                {!!count && <span className="topnav-badge">{count}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="topnav-right">
          <button
            className={`topnav-vacation${vacation ? " on" : ""}`}
            onClick={toggleVacation}
            disabled={savingVacation || vacation === null || !canSave}
            title={
              !canSave
                ? "This deployment can't save settings"
                : vacation
                  ? "Automation is frozen — click to resume"
                  : "Click to freeze the daily scrape (no spend)"
            }
          >
            <span className="topnav-vacation-dot" />
            {vacation === null ? "…" : vacation ? "Vacation" : "Active"}
          </button>

          <Link
            href={`/admin/settings?tab=${sectionForPathname(pathname)}`}
            className="topnav-icon-btn"
            title="Settings"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>

          <button
            type="button"
            className="topnav-icon-btn"
            title="Sign out"
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
              window.location.href = "/login";
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" />
              <polyline points="16 17 21 12 16 7" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="21" y1="12" x2="9" y2="12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
