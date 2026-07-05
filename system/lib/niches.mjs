/**
 * Niche registry — single source of truth for every vertical Terrytory runs.
 * A niche is one JSON file in system/niches/ describing its sources,
 * editorial voice, brand, and monetization. Everything downstream
 * (scraper engine, content pipeline, scheduler, website) reads from here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SYSTEM_ROOT = path.resolve(__dirname, "..");
const NICHES_DIR = path.join(SYSTEM_ROOT, "niches");

export function listNicheIds() {
  return fs
    .readdirSync(NICHES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadNiche(id) {
  const file = path.join(NICHES_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown niche "${id}". Available: ${listNicheIds().join(", ")}`);
  }
  const niche = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (niche.id !== id) throw new Error(`Niche file ${file} has mismatched id "${niche.id}"`);
  return niche;
}

export function listNiches() {
  return listNicheIds().map(loadNiche);
}

export function enabledNiches() {
  return listNiches().filter((n) => n.enabled !== false);
}

/**
 * Canonical filesystem layout for a niche. Every consumer resolves
 * paths through here — nothing hardcodes directories anymore.
 */
export function nichePaths(id) {
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
    scraperData,
    sourceData: (sourceId) => path.join(scraperData, sourceId),
    digestsDir: path.join(scraperData, "digests"),
    latestDigest: path.join(scraperData, "digests", "latest_digest.json"),
    orchestratorLog: path.join(scraperData, "orchestrator.log"),
  };
}

/** Create all directories for a niche if missing. */
export function ensureNicheDirs(id) {
  const p = nichePaths(id);
  [p.content, p.picks, p.drafts, p.images, p.shipped, p.rejected, p.published, p.scraperData, p.digestsDir].forEach(
    (d) => fs.mkdirSync(d, { recursive: true })
  );
  return p;
}
