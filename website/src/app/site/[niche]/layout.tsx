import type { ReactNode, CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fraunces } from "next/font/google";
import { isValidNiche, magBasePath, nicheBrand } from "@/lib/site";
import "./magazine.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ niche: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ niche: string }> }): Promise<Metadata> {
  const { niche } = await params;
  if (!isValidNiche(niche)) return { title: "TERRYTORY" };
  const brand = nicheBrand(niche);
  return {
    title: { default: brand.name, template: `%s — ${brand.name}` },
    description: brand.heroSubtitle,
  };
}

export default async function MagazineLayout({ children, params }: LayoutProps) {
  const { niche } = await params;
  if (!isValidNiche(niche)) notFound();

  const brand = nicheBrand(niche);
  const base = await magBasePath(niche);
  const home = base || "/";
  const year = new Date().getFullYear();

  return (
    <div className={`mag ${display.variable}`} style={{ "--accent": brand.accent } as CSSProperties}>
      <div className="mag-grain" aria-hidden />
      <div className="mag-shell">
        <header className="mag-masthead">
          <Link className="mag-brand" href={home}>
            <span className="mag-brand-mark">
              Terry<em>tory</em>
            </span>
            <span className="mag-brand-sub">{brand.shortName}</span>
          </Link>
          <nav className="mag-nav">
            <Link href={home}>Latest</Link>
            <a href={`${base}/#footer`}>About</a>
          </nav>
        </header>

        {children}

        <footer className="mag-footer" id="footer">
          <div className="mag-container mag-footer-inner">
            <span className="mag-footer-brand">
              Terry<em>tory</em> {brand.shortName}
            </span>
            <span className="mag-footer-note">
              © {year} · {brand.tagline || "Independent, AI-assisted journalism"}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
