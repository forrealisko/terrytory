import Link from "next/link";
import type { CSSProperties } from "react";
import { Fraunces } from "next/font/google";
import { listNiches } from "@/lib/niches";
import { listPublished } from "@/lib/article-store";
import "@/styles/magazine.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const dynamic = "force-dynamic";

export default function Landing() {
  const pubs = listNiches()
    .filter((n) => n.enabled !== false)
    .map((n) => ({
      id: n.id,
      brand: n.brand,
      count: listPublished(1, 200, n.id).articles.length,
    }));

  return (
    <div
      className={`mag ${display.variable}`}
      style={{ "--accent": "#159a67" } as CSSProperties}
    >
      <div className="mag-grain" aria-hidden />
      <div className="mag-shell">
        <header className="mag-masthead">
          <Link className="mag-brand" href="/">
            <span className="mag-brand-mark">
              Terry<em>tory</em>
            </span>
          </Link>
          <nav className="mag-nav">
            {pubs.map((p) => (
              <Link key={p.id} href={`/site/${p.id}`}>
                {p.brand?.shortName || p.id}
              </Link>
            ))}
          </nav>
        </header>

        <div className="mag-container">
          <section className="mag-lede rise rise-1">
            <span className="mag-eyebrow">The Terrytory Network</span>
            <h1 className="mag-lede-title">
              Journalism,
              <br />
              <span className="i">on autopilot.</span>
            </h1>
            <p className="mag-lede-sub">
              Independent publications covering the stories that matter —
              researched, written, and illustrated every day. Choose a beat.
            </p>
          </section>

          <section className="mag-hub rise rise-2">
            {pubs.map((p) => (
              <Link
                key={p.id}
                href={`/site/${p.id}`}
                className="mag-hub-card"
                style={{ "--accent": p.brand?.accent || "#159a67" } as CSSProperties}
              >
                <span className="mag-hub-kicker">
                  {p.count} article{p.count === 1 ? "" : "s"}
                </span>
                <h2 className="mag-hub-title">{p.brand?.name || p.id}</h2>
                <p className="mag-hub-tagline">{p.brand?.tagline || ""}</p>
                <span className="mag-hub-cta">
                  Read {p.brand?.shortName || p.id} →
                </span>
              </Link>
            ))}
          </section>
        </div>

        <footer className="mag-footer" id="footer">
          <div className="mag-container mag-footer-inner">
            <span className="mag-footer-brand">
              Terry<em>tory</em>
            </span>
            <span className="mag-footer-note">
              © {new Date().getFullYear()} · Independent, AI-assisted journalism
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
