/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  UFO SCRAPER ORCHESTRATOR v1.0                              ║
 * ║  Runs all 3 scrapers sequentially, then merges only NEW     ║
 * ║  articles into a single timestamped digest file.            ║
 * ║  Designed to run every 12 hours via macOS launchd.          ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// ─── Paths ───────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UFO_ROOT   = path.resolve(__dirname, ".."); // parent = ufo/
const DATA_DIR   = path.join(__dirname, "data");
const DIGESTS_DIR = path.join(DATA_DIR, "digests");
const LOG_FILE   = path.join(DATA_DIR, "orchestrator.log");

// ─── Scraper registry ────────────────────────────────────────────────────────
const SCRAPERS = [
  {
    id:   "theblackvault",
    name: "The Black Vault",
    dir:  path.join(UFO_ROOT, "theblackvault"),
  },
  {
    id:   "liberationtimes",
    name: "Liberation Times",
    dir:  path.join(UFO_ROOT, "liberationtimes"),
  },
  {
    id:   "thedebrief",
    name: "The Debrief",
    dir:  path.join(UFO_ROOT, "thedebrief"),
  },
];

// ─── Ensure directories exist ────────────────────────────────────────────────
[DATA_DIR, DIGESTS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// ─── Logger ──────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ─── Run a single scraper ────────────────────────────────────────────────────
function runScraper(scraper) {
  log("info", `▶  Starting ${scraper.name}...`);
  const start = Date.now();
  try {
    execSync("npm run scrape:headless", {
      cwd:   scraper.dir,
      stdio: "inherit",          // stream logs straight to terminal
      env:   { ...process.env, HEADLESS: "true" },
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log("info", `✓  ${scraper.name} done in ${elapsed}s`);
    return { ok: true, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log("error", `✗  ${scraper.name} failed after ${elapsed}s: ${err.message}`);
    return { ok: false, elapsed, error: err.message };
  }
}

// ─── Read latest.json from a scraper ────────────────────────────────────────
function readLatest(scraper) {
  const latestPath = path.join(scraper.dir, "data", "latest.json");
  try {
    const raw = fs.readFileSync(latestPath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    log("warn", `Could not read latest.json for ${scraper.name}: ${err.message}`);
    return null;
  }
}

// ─── Extract only NEW articles from a payload ────────────────────────────────
function extractNew(payload, scraperId, scraperName) {
  if (!payload?.headlines) return [];

  return payload.headlines
    .filter((h) => h.is_new === true)
    .map((h) => ({
      source_id:   scraperId,
      source_name: scraperName,
      type:        h.type        ?? "article",
      title:       h.title,
      url:         h.url,
      image_url:   h.image_url   ?? null,
      author:      h.author      ?? null,
      excerpt:     h.excerpt     ?? null,
      article_date: h.article_date ?? null,
      date_analysis: h.date_analysis ?? null,
      categories:  h.categories  ?? [],
      tags:        h.tags        ?? [],
      first_seen:  h.first_seen,
    }));
}

// ─── Save digest ─────────────────────────────────────────────────────────────
function saveDigest(digest) {
  const ts       = digest.meta.run_at.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const filename = `digest_${ts}.json`;
  const filepath = path.join(DIGESTS_DIR, filename);

  // Atomic write
  const tmp = filepath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(digest, null, 2));
  fs.renameSync(tmp, filepath);
  log("info", `Digest saved → ${filepath}`);

  // Always update latest_digest.json
  const latestPath = path.join(DATA_DIR, "latest_digest.json");
  const tmp2       = latestPath + ".tmp";
  fs.writeFileSync(tmp2, JSON.stringify(digest, null, 2));
  fs.renameSync(tmp2, latestPath);
  log("info", `latest_digest.json updated`);

  return filepath;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const runAt = new Date().toISOString();

  log("info", "═══════════════════════════════════════════════════════");
  log("info", "UFO Orchestrator starting");
  log("info", `Run timestamp: ${runAt}`);
  log("info", `Scrapers: ${SCRAPERS.map((s) => s.name).join(", ")}`);

  // ── Step 1: Run all scrapers sequentially ──
  const runResults = {};
  for (const scraper of SCRAPERS) {
    runResults[scraper.id] = runScraper(scraper);
  }

  // ── Step 2: Collect new articles from each latest.json ──
  log("info", "─── Collecting new articles ───");
  const allNew = [];

  for (const scraper of SCRAPERS) {
    const result = runResults[scraper.id];
    if (!result.ok) {
      log("warn", `Skipping ${scraper.name} digest (scraper failed)`);
      continue;
    }

    const payload = readLatest(scraper);
    if (!payload) continue;

    const newArticles = extractNew(payload, scraper.id, scraper.name);
    log("info", `  ${scraper.name}: ${newArticles.length} new article(s)`);
    allNew.push(...newArticles);
  }

  // Sort by article_date descending (most recent first), nulls last
  allNew.sort((a, b) => {
    const da = a.article_date ? new Date(a.article_date).getTime() : 0;
    const db = b.article_date ? new Date(b.article_date).getTime() : 0;
    return db - da;
  });

  // ── Step 3: Build and save digest ──
  const digest = {
    meta: {
      digest_id:      crypto.randomUUID(),
      run_at:         runAt,
      orchestrator_version: "1.0.0",
      sources_attempted: SCRAPERS.length,
      sources_ok:     Object.values(runResults).filter((r) => r.ok).length,
      sources_failed: Object.values(runResults).filter((r) => !r.ok).length,
      total_new:      allNew.length,
      run_results:    Object.fromEntries(
        SCRAPERS.map((s) => [s.id, runResults[s.id]])
      ),
    },
    articles: allNew,
  };

  saveDigest(digest);

  // ── Step 4: Print summary ──
  log("info", "─── Run Summary ───────────────────────────────────────");
  log("info", `  Total new articles: ${allNew.length}`);
  for (const scraper of SCRAPERS) {
    const r = runResults[scraper.id];
    const label = r.ok ? `✓ ${r.elapsed}s` : `✗ FAILED`;
    log("info", `  ${scraper.name.padEnd(20)} ${label}`);
  }

  if (allNew.length === 0) {
    log("info", "  No new articles this run — all headlines already seen.");
  } else {
    log("info", "  Latest new articles:");
    allNew.slice(0, 10).forEach((a, i) => {
      log("info", `    ${i + 1}. [${a.source_name}] ${a.title}`);
    });
    if (allNew.length > 10) {
      log("info", `    ... and ${allNew.length - 10} more`);
    }
  }

  log("info", "Orchestrator done ✓");

  // ── Step 5: Trigger AI article rating if we have new content ──
  if (allNew.length > 0) {
    const contentDir = path.resolve(__dirname, "..", "..", "content");
    const raterScript = path.join(contentDir, "rate-scrapes.mjs");

    if (fs.existsSync(raterScript)) {
      log("info", "─── Triggering AI topic rating ───");
      try {
        execSync(`node rate-scrapes.mjs`, {
          cwd: contentDir,
          stdio: "inherit",
          env: { ...process.env },
        });
        log("info", "Topic rating complete ✓");
      } catch (err) {
        log("error", `Topic rating failed: ${err.message}`);
      }
    } else {
      log("info", "Topic rater not found — skipping topic rating.");
    }
  }
}

main().catch((err) => {
  log("error", `Unhandled error: ${err.message}`);
  log("error", err.stack);
  process.exit(1);
});
