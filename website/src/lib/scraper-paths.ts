/**
 * Centralized paths to scraper data files.
 * Used by API routes to read the latest scrape JSON.
 *
 * Uses auto-discovery to resolve the scraper base directory
 * regardless of how Next.js is started (npm run dev, build, etc.).
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = process.cwd();

/**
 * Auto-discovery resolver for the scraper base directory.
 * Checks multiple candidate paths to handle different working directories.
 */
const getScraperBase = (): string => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const resolved = path.resolve(currentDir, "..", "..", "..", "system", "scraper", "ufo");
  if (fs.existsSync(resolved)) return resolved;

  if (process.env.SCRAPER_BASE_PATH) {
    return path.resolve(PROJECT_ROOT, process.env.SCRAPER_BASE_PATH);
  }

  // Fallback to standard relative resolve
  console.warn(
    `[scraper-paths] Could not auto-discover scraper base. Falling back to default relative path.`
  );
  return resolved;
};

const SCRAPER_BASE = getScraperBase();

export const SCRAPER_PATHS = {
  base: SCRAPER_BASE,
  sources: {
    theblackvault: {
      id: "theblackvault",
      name: "The Black Vault",
      color: "#f59e0b",
      latest: path.join(SCRAPER_BASE, "theblackvault", "data", "latest.json"),
    },
    liberationtimes: {
      id: "liberationtimes",
      name: "Liberation Times",
      color: "#3b82f6",
      latest: path.join(
        SCRAPER_BASE,
        "liberationtimes",
        "data",
        "latest.json"
      ),
    },
    thedebrief: {
      id: "thedebrief",
      name: "The Debrief",
      color: "#8b5cf6",
      latest: path.join(SCRAPER_BASE, "thedebrief", "data", "latest.json"),
    },
  },
  digest: path.join(
    SCRAPER_BASE,
    "orchestrator",
    "data",
    "latest_digest.json"
  ),
} as const;

export type SourceId = keyof typeof SCRAPER_PATHS.sources;
