/**
 * One-shot scrape of every enabled niche, then push a top-picks digest to
 * Telegram. Designed for GitHub Actions (cron) — no daemon, runs once, exits.
 *
 *   node system/scrape-all.mjs
 *
 * Each niche's scrape auto-runs the ranker + rater, producing picks. We then
 * send the top 6 pending picks per niche so you can choose what to write.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enabledNiches, nichePaths } from "./lib/niches.mjs";
import { sendTelegram, esc, telegramConfigured } from "./notify/telegram.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(__dirname, "scraper", "engine", "scrape.mjs");

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

  // 2. Digest of top pending picks → Telegram
  let sentAny = false;
  for (const niche of niches) {
    const picks = readPendingPicks(niche.id)
      .sort((a, b) => (b.rating || 0) - (a.rating || 0))
      .slice(0, 6);
    if (!picks.length) continue;

    const brand = niche.brand?.name || niche.id;
    const lines = [`📰 <b>${esc(brand)}</b> — top ${picks.length} picks`, ""];
    picks.forEach((p, i) => {
      const src = p.source_articles?.[0]?.source_name || "";
      lines.push(`<b>${i + 1}.</b> ${esc(p.headline)}`);
      lines.push(`    ⭐ ${p.rating ?? "?"}/10 · ${esc(src)}`);
    });
    lines.push("");
    lines.push(`Tap a button below or reply <code>/gen ${niche.id} ${picks[0].id}</code>`);

    const buttons = picks.map((p, i) => [
      { text: `✍️ Generate #${i + 1}`, callback_data: `gen:${niche.id}:${p.id}` },
    ]);

    const ok = await sendTelegram(lines.join("\n"), { buttons });
    sentAny = sentAny || ok;
  }

  if (!telegramConfigured()) {
    console.log("[scrape-all] Telegram not configured — digest skipped (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID).");
  } else if (!sentAny) {
    console.log("[scrape-all] No new pending picks to report.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
