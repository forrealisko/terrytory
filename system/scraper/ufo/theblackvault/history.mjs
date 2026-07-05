/**
 * History viewer — quickly inspect scrape history and memory stats
 * Usage: node history.mjs [--all | --new | --stats]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const SCRAPES_DIR = path.join(DATA_DIR, "scrapes");

const flag = process.argv[2] || "--stats";

function loadMemory() {
  if (!fs.existsSync(MEMORY_FILE)) {
    console.log("No memory file found. Run the scraper first.");
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
}

function loadLatest() {
  const latestPath = path.join(DATA_DIR, "latest.json");
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, "utf-8"));
}

if (flag === "--stats") {
  const mem = loadMemory();
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  THE BLACK VAULT — SCRAPER STATS     ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`  Memory created:    ${mem.created_at}`);
  console.log(`  Last scrape:       ${mem.last_scrape || "never"}`);
  console.log(`  Total scrape runs: ${mem.total_scrapes}`);
  console.log(`  Headlines tracked: ${Object.keys(mem.seen_hashes).length}`);

  // Show scrape files
  if (fs.existsSync(SCRAPES_DIR)) {
    const files = fs.readdirSync(SCRAPES_DIR).filter((f) => f.endsWith(".json")).sort();
    console.log(`\n  Scrape files (${files.length}):`);
    files.forEach((f) => console.log(`    • ${f}`));
  }
  console.log();
}

if (flag === "--all") {
  const latest = loadLatest();
  if (!latest) {
    console.log("No scrape data found. Run the scraper first.");
    process.exit(0);
  }
  console.log(`\nLatest scrape: ${latest.meta.scraped_at}`);
  console.log(`Total headlines: ${latest.meta.total_headlines}\n`);
  latest.headlines.forEach((h, i) => {
    const age = h.date_analysis?.relative || "unknown";
    const flag = h.is_new ? "🆕" : "  ";
    console.log(`${flag} [${h.type.padEnd(9)}] [${age.padEnd(10)}] ${h.title}`);
  });
  console.log();
}

if (flag === "--new") {
  const latest = loadLatest();
  if (!latest) {
    console.log("No scrape data found.");
    process.exit(0);
  }
  const newOnes = latest.headlines.filter((h) => h.is_new);
  console.log(`\n🆕 New headlines from last scrape (${newOnes.length}):\n`);
  newOnes.forEach((h) => {
    console.log(`  [${h.type}] ${h.title}`);
    console.log(`    URL: ${h.url}`);
    console.log(`    Date: ${h.article_date || "unknown"} (${h.date_analysis?.relative || "?"})`);
    console.log();
  });
}
