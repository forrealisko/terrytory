/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY AUTOMATED CONTENT CYCLE v2 — niche-aware          ║
 * ║  Runs at 12:00 AM and 12:00 PM CET per niche.                ║
 * ║                                                              ║
 * ║  1. Auto-publishes pending drafts from the previous cycle.   ║
 * ║  2. Selects top N picks (starred picks prioritized first).   ║
 * ║  3. Research + write + images for each.                      ║
 * ║                                                              ║
 * ║  Usage: node run-automated-cycle.mjs --niche ufo             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./content-config.mjs";
import {
  cliNiche,
  getNicheContext,
  getApiKey,
  generateDraftFromPick,
  readStarred,
} from "./pipeline-core.mjs";

const ctx = getNicheContext(cliNiche());
const { log, paths, niche } = ctx;

// ─── Phase 1: Auto-publish drafts from the previous cycle ───────────────────
function autoPublishPendingDrafts() {
  log("info", "Phase 1: Auto-publishing pending drafts from previous cycle...");
  try {
    const files = fs.readdirSync(paths.drafts).filter((f) => f.endsWith(".json"));
    let count = 0;

    for (const f of files) {
      const filePath = path.join(paths.drafts, f);
      try {
        const draft = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (draft.status !== "draft") continue;

        const now = new Date().toISOString();
        const publishedSlug = `${now.slice(0, 10)}_${draft.slug || draft.id}`;
        const published = {
          ...draft,
          status: "published",
          selected_headline: draft.selected_headline || draft.headline_options?.[0] || "Untitled",
          published_at: now,
          published_slug: publishedSlug,
        };

        fs.writeFileSync(path.join(paths.published, `${publishedSlug}.json`), JSON.stringify(published, null, 2));
        fs.unlinkSync(filePath);
        log("info", `  ✓ Auto-published: "${published.selected_headline}" → ${publishedSlug}`);
        count++;
      } catch (err) {
        log("error", `  ✗ Failed to auto-publish ${f}: ${err.message}`);
      }
    }
    log("info", `Phase 1 done: auto-published ${count} draft(s).`);
  } catch (err) {
    log("error", `Phase 1 failed: ${err.message}`);
  }
}

// ─── Phase 2: Select picks and generate drafts ───────────────────────────────
async function runAutomatedGeneration(apiKey) {
  log("info", `Phase 2: Selecting top ${CONFIG.drafts_per_cycle} picks...`);

  const starredData = readStarred(ctx);
  const activeStars = new Set(Object.keys(starredData.active || {}));
  log("info", `Found ${activeStars.size} active starred URL(s).`);

  const pickFiles = fs.existsSync(paths.picks)
    ? fs.readdirSync(paths.picks).filter((f) => f.endsWith(".json"))
    : [];

  const pendingPicks = [];
  for (const file of pickFiles) {
    try {
      const pick = JSON.parse(fs.readFileSync(path.join(paths.picks, file), "utf-8"));
      if (pick.status === "pending") {
        pick._hasStarred = (pick.source_articles || []).some((src) => activeStars.has(src.url));
        pendingPicks.push(pick);
      }
    } catch {}
  }

  log("info", `Loaded ${pendingPicks.length} pending pick(s).`);
  if (pendingPicks.length === 0) return log("info", "No pending picks to process.");

  // Starred first, then highest rating, then oldest
  pendingPicks.sort((a, b) => {
    if (a._hasStarred !== b._hasStarred) return a._hasStarred ? -1 : 1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const selected = pendingPicks.slice(0, CONFIG.drafts_per_cycle);
  selected.forEach((p, i) =>
    log("info", `  ${i + 1}. [Rating: ${p.rating}] "${p.headline}" (Starred: ${p._hasStarred})`)
  );

  for (const pick of selected) {
    log("info", `▶ Generating: "${pick.headline}"`);
    try {
      await generateDraftFromPick(ctx, pick, apiKey);
      log("info", `✓ Completed: "${pick.headline}"`);
    } catch (err) {
      log("error", `✗ Generation failed for "${pick.headline}": ${err.message}`);
      if (err.stack) log("error", err.stack);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log("info", "═══════════════════════════════════════════════════════");
  log("info", `Automated Content Cycle starting — niche: ${niche.id}`);

  autoPublishPendingDrafts();

  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (err) {
    log("error", `API Key configuration error: ${err.message}`);
    process.exit(1);
  }

  await runAutomatedGeneration(apiKey);
  log("info", "Automated content cycle completed ✓");
}

main().catch((err) => {
  log("error", `Unhandled fatal cycle error: ${err.message}`);
  process.exit(1);
});
