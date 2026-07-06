/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NICHE REGISTRY (website side)                               ║
 * ║  Reads system/niches/*.json — the single source of truth     ║
 * ║  shared with the scraper engine and content pipeline.        ║
 * ║                                                              ║
 * ║  Active niche resolution order:                              ║
 * ║    1. ?niche= query param   2. "niche" cookie   3. "ufo"     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextRequest } from "next/server";

export const DEFAULT_NICHE = "ai";
export const NICHE_COOKIE = "niche";

// ─── System root discovery ───────────────────────────────────────────────────
function getSystemRoot(): string {
  // Walk up from both the compiled file and the cwd looking for system/niches.
  // Fixed relative paths break on Vercel, where the function bundle nests the
  // traced system/ folder at an unpredictable depth.
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(dir, "system", "niches"))) {
        return path.join(dir, "system");
      }
      if (fs.existsSync(path.join(dir, "niches", `${DEFAULT_NICHE}.json`))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return path.resolve(process.cwd(), "system");
}

export const SYSTEM_ROOT = getSystemRoot();

// ─── Types ───────────────────────────────────────────────────────────────────
export interface NicheSource {
  id: string;
  name: string;
  color: string;
  type: "html" | "rss";
  url: string;
}

export interface NicheConfig {
  id: string;
  enabled: boolean;
  brand: {
    name: string;
    shortName?: string;
    tagline: string;
    accent: string;
    hero_title: string;
    hero_subtitle: string;
  };
  editorial: Record<string, unknown>;
  monetization: { mode: string; programs: unknown[]; disclosure: string };
  sources: NicheSource[];
}

// ─── Registry ────────────────────────────────────────────────────────────────
export function listNicheIds(): string[] {
  try {
    return fs
      .readdirSync(path.join(SYSTEM_ROOT, "niches"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [DEFAULT_NICHE];
  }
}

export function getNiche(id: string): NicheConfig {
  try {
    const file = path.join(SYSTEM_ROOT, "niches", `${id}.json`);
    return JSON.parse(fs.readFileSync(file, "utf-8")) as NicheConfig;
  } catch {
    // Never crash the whole page if a config can't be read — degrade to a
    // disabled placeholder so the site renders (empty) instead of 500ing.
    return { id, enabled: false, brand: { name: id, shortName: id } } as NicheConfig;
  }
}

export function listNiches(): NicheConfig[] {
  return listNicheIds().map(getNiche);
}

export function isValidNiche(id: string | null | undefined): id is string {
  return !!id && /^[a-z0-9-]+$/.test(id) && fs.existsSync(path.join(SYSTEM_ROOT, "niches", `${id}.json`));
}

/** Resolve the active niche from a request (query param → cookie → default). */
export function resolveNiche(req?: NextRequest): string {
  if (req) {
    const fromQuery = req.nextUrl.searchParams.get("niche");
    if (isValidNiche(fromQuery)) return fromQuery;
    const fromCookie = req.cookies.get(NICHE_COOKIE)?.value;
    if (isValidNiche(fromCookie)) return fromCookie;
  }
  return DEFAULT_NICHE;
}

// ─── Filesystem layout (mirror of system/lib/niches.mjs) ────────────────────
export function nichePaths(id: string) {
  const content = path.join(SYSTEM_ROOT, "content", "niches", id);
  const scraperData = path.join(SYSTEM_ROOT, "scraper", "data", id);
  return {
    content,
    picks: path.join(content, "picks"),
    drafts: path.join(content, "drafts"),
    images: path.join(content, "images"),
    shipped: path.join(content, "shipped"),
    rejected: path.join(content, "rejected"),
    published: path.join(content, "published"),
    starred: path.join(content, "starred-scrapes.json"),
    generatorLog: path.join(content, "generator.log"),
    generatorPid: path.join(content, "generator.pid"),
    scraperData,
    sourceLatest: (sourceId: string) => path.join(scraperData, sourceId, "latest.json"),
    latestDigest: path.join(scraperData, "digests", "latest_digest.json"),
    orchestratorLog: path.join(scraperData, "orchestrator.log"),
    scraperPid: path.join(scraperData, "scraper.pid"),
  };
}

export function ensureNicheDirs(id: string) {
  const p = nichePaths(id);
  [p.content, p.picks, p.drafts, p.images, p.shipped, p.rejected, p.published, p.scraperData].forEach((d) =>
    fs.mkdirSync(d, { recursive: true })
  );
  return p;
}

// ─── Script locations for spawning ───────────────────────────────────────────
export const SCRIPTS = {
  scrape: path.join(SYSTEM_ROOT, "scraper", "engine", "scrape.mjs"),
  rate: path.join(SYSTEM_ROOT, "content", "rate-scrapes.mjs"),
  writePicked: path.join(SYSTEM_ROOT, "content", "write-picked.mjs"),
  cycle: path.join(SYSTEM_ROOT, "content", "run-automated-cycle.mjs"),
  contentDir: path.join(SYSTEM_ROOT, "content"),
  schedulerStatus: path.join(SYSTEM_ROOT, "content", "scheduler-status.json"),
};
