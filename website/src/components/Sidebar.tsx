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

export function Sidebar() {
  const pathname = usePathname();
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [niches, setNiches] = useState<NicheInfo[]>([]);
  const [activeNiche, setActiveNiche] = useState<string>("ai");

  useEffect(() => {
    fetch("/api/niches")
      .then((r) => r.json())
      .then((d) => {
        if (d.niches) setNiches(d.niches);
        if (d.active) setActiveNiche(d.active);
      })
      .catch(() => {});
  }, []);

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
    fetchCount();

    // Poll occasionally (every 30 seconds)
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandMark size={34} />
        <h1 className="brand-title-powerful">TERRYTORY</h1>
      </div>

      {niches.length > 1 && (
        <div style={{ padding: "12px 12px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
          {niches.map((n) => {
            const isActive = n.id === activeNiche;
            return (
              <button
                key={n.id}
                onClick={() => switchNiche(n.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                  border: `1px solid ${isActive ? `${n.accent}44` : "transparent"}`,
                  background: isActive ? `${n.accent}14` : "transparent",
                  color: isActive ? n.accent : "var(--text-secondary)",
                  textAlign: "left",
                  width: "100%",
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
                  background: "var(--accent-fresh, #00e676)",
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
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <div className="sidebar-status-dot" />
          <span>Scrapers active</span>
        </div>
      </div>
    </aside>
  );
}
