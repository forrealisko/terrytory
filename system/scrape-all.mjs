/**
 * One-shot scrape of every enabled niche. Designed for GitHub Actions (cron) —
 * no daemon, runs once, exits.
 *
 *   node system/scrape-all.mjs
 *
 * Each niche's scrape auto-runs the ranker + rater, producing picks. The picks
 * land in system/content/niches/<niche>/picks and surface in the Editorial Desk
 * (/admin/chat) — no external notifier. The workflow commits them back to git.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enabledNiches, nichePaths } from "./lib/niches.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(__dirname, "scraper", "engine", "scrape.mjs");
const DIRECTOR = path.join(__dirname, "content", "creative-director.mjs");

function readPendingPicks(id) {
  const dir = nichePaths(id).picks;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((p) => p && (p.status || "pending") === "pending");
}

async function main() {
  const niches = enabledNiches();
  console.log(`[scrape-all] ${niches.length} enabled niche(s): ${niches.map((n) => n.id).join(", ")}`);

  // 1. Scrape each niche (auto-runs rank + rate → picks)
  for (const niche of niches) {
    console.log(`\n[scrape-all] ▶ scraping ${niche.id}…`);
    const r = spawnSync("node", [ENGINE, "--niche", niche.id], { stdio: "inherit" });
    if (r.status !== 0) console.warn(`[scrape-all] ⚠ ${niche.id} scrape exited ${r.status}`);
  }

  // 2. Log a digest of top pending picks (picks are consumed by the Editorial Desk).
  for (const niche of niches) {
    const picks = readPendingPicks(niche.id)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 6);
    const brand = niche.brand?.name || niche.id;
    if (!picks.length) {
      console.log(`\n[scrape-all] ${brand}: no new pending picks.`);
      continue;
    }
    console.log(`\n[scrape-all] ${brand} — top ${picks.length} picks:`);
    picks.forEach((p, i) => {
      const src = p.source_articles?.[0]?.source_name || "";
      console.log(`  ${i + 1}. [${p.rating ?? "?"}/10] ${p.headline}${src ? ` · ${src}` : ""}`);
    });
  }

  // 3. Creative Director proposes each niche's daily slate (2-5 ideas) from the
  //    fresh picks. --daily banks any un-picked ideas from the previous slate so
  //    the new day starts clean. This is the autonomous heart: every morning a
  //    curated slate is waiting in the Studio without anyone clicking Generate.
  for (const niche of niches) {
    if (!readPendingPicks(niche.id).length) continue;
    console.log(`\n[scrape-all] ▶ planning ${niche.id} slate…`);
    const r = spawnSync("node", [DIRECTOR, "plan", "--niche", niche.id, "--daily"], { stdio: "inherit" });
    if (r.status !== 0) console.warn(`[scrape-all] ⚠ ${niche.id} planning exited ${r.status}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
