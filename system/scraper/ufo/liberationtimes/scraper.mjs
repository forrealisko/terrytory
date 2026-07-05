/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  LIBERATION TIMES — HEADLINE SCRAPER v1.0                   ║
 * ║  Smart, robust, memory-aware scraper for homepage headlines  ║
 * ║  Proxy-ready • Deduplication • Incremental • Date-aware      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Site architecture: Squarespace blog-basic-grid layout.
 *
 * Each article lives inside:
 *   <article class="blog-basic-grid--container entry blog-item">
 *
 * Within each article:
 *   Title:   h1.blog-title > a[href]
 *   Date:    time.blog-date (text like "6/17/26", duplicated in primary/secondary spans)
 *   Author:  span.blog-author
 *   Excerpt: div.blog-excerpt-wrapper p
 *   URL:     h1.blog-title > a[href]  (relative paths like /home/slug)
 *
 * Important: Dates do NOT use a `datetime` attribute. They are plain
 * text in M/D/YY format (e.g. "6/17/26"). We parse them manually.
 * The base URL must be prepended to relative hrefs.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

// ─── Paths ───────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const SCRAPES_DIR = path.join(DATA_DIR, "scrapes");
const MEMORY_FILE = path.join(DATA_DIR, "memory.json");
const LOG_FILE = path.join(DATA_DIR, "scraper.log");

const TARGET_URL = "https://www.liberationtimes.com/";
const BASE_URL = "https://www.liberationtimes.com";

// ─── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  headless: process.env.HEADLESS === "true",
  dryRun: process.argv.includes("--dry-run"),
  timeout: 60_000,
  retries: 3,
  retryDelay: 3_000,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  // Proxy placeholder — fill in later
  // proxy: { server: "http://proxy:port", username: "", password: "" },
  proxy: null,
};

// ─── Ensure directories ─────────────────────────────────────────────────────
[DATA_DIR, SCRAPES_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// ─── Logger ──────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ─── Memory System ──────────────────────────────────────────────────────────
// Tracks every headline ever seen. Stores a fingerprint (hash of URL) so we
// can detect new vs. already-scraped articles across runs.
class Memory {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filepath)) {
        return JSON.parse(fs.readFileSync(this.filepath, "utf-8"));
      }
    } catch (e) {
      log("warn", `Memory file corrupted, starting fresh: ${e.message}`);
    }
    return {
      version: 1,
      created_at: new Date().toISOString(),
      last_scrape: null,
      total_scrapes: 0,
      seen_hashes: {},       // hash -> { first_seen, last_seen, title, url }
      stats: {
        total_headlines_ever: 0,
        total_new_this_session: 0,
      },
    };
  }

  save() {
    // Atomic write: write to tmp then rename
    const tmp = this.filepath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filepath);
  }

  /**
   * Check if a headline URL has been seen before.
   * Returns { isNew: boolean, firstSeen?: string }
   */
  check(url) {
    const hash = this._hash(url);
    if (this.data.seen_hashes[hash]) {
      return { isNew: false, firstSeen: this.data.seen_hashes[hash].first_seen };
    }
    return { isNew: true };
  }

  /**
   * Record a headline in memory.
   */
  record(headline) {
    const hash = this._hash(headline.url);
    const now = new Date().toISOString();

    if (!this.data.seen_hashes[hash]) {
      this.data.seen_hashes[hash] = {
        first_seen: now,
        last_seen: now,
        title: headline.title,
        url: headline.url,
      };
      this.data.stats.total_headlines_ever++;
      this.data.stats.total_new_this_session++;
    } else {
      this.data.seen_hashes[hash].last_seen = now;
      // Update title in case it was edited
      this.data.seen_hashes[hash].title = headline.title;
    }
  }

  recordScrapeRun() {
    this.data.last_scrape = new Date().toISOString();
    this.data.total_scrapes++;
  }

  resetSessionStats() {
    this.data.stats.total_new_this_session = 0;
  }

  _hash(str) {
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
  }
}

// ─── Date Intelligence ──────────────────────────────────────────────────────
// Liberation Times uses short M/D/YY text (e.g. "6/17/26") without datetime attr.
// We parse it into a proper Date.
function parseLiberationDate(dateText) {
  if (!dateText) return null;

  const cleaned = dateText.trim();
  // Expected format: M/D/YY  (e.g. "6/17/26", "12/3/25")
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  let [, month, day, year] = match;
  // Handle 2-digit year
  if (year.length === 2) {
    const y = parseInt(year, 10);
    year = (y > 50 ? 1900 + y : 2000 + y).toString();
  }

  const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function classifyDate(isoDateStr) {
  if (!isoDateStr) return { relative: "unknown", age_days: null, parsed: null };

  const articleDate = new Date(isoDateStr);
  const now = new Date();
  const diffMs = now - articleDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relative;
  if (diffDays < 0) {
    relative = "future"; // Scheduled / pre-dated
  } else if (diffDays === 0) {
    relative = "today";
  } else if (diffDays === 1) {
    relative = "yesterday";
  } else if (diffDays <= 7) {
    relative = "this_week";
  } else if (diffDays <= 30) {
    relative = "this_month";
  } else if (diffDays <= 365) {
    relative = "this_year";
  } else {
    relative = "older";
  }

  return {
    relative,
    age_days: diffDays,
    parsed: articleDate.toISOString(),
  };
}

// ─── Scraping Engine ────────────────────────────────────────────────────────
async function scrapeHeadlines(page) {
  log("info", "Extracting headlines from DOM...");

  const rawHeadlines = await page.evaluate((baseUrl) => {
    const results = [];
    const seen = new Set(); // dedup within same page

    // Liberation Times — Squarespace blog-basic-grid layout
    // Each article: article.blog-basic-grid--container.blog-item
    document.querySelectorAll("article.blog-item").forEach((article) => {
      // Title & URL
      const titleLink = article.querySelector("h1.blog-title a");
      if (!titleLink) return;

      let url = titleLink.href;
      // Ensure absolute URL (Squarespace uses relative paths)
      if (url.startsWith("/")) {
        url = baseUrl + url;
      }

      if (seen.has(url)) return;
      seen.add(url);

      // Date — time.blog-date (plain text like "6/17/26")
      // The date appears in both .blog-meta-primary and .blog-meta-secondary
      // We grab the first one to avoid duplicates
      const dateEl = article.querySelector(".blog-meta-primary time.blog-date");
      const dateText = dateEl?.textContent?.trim() || null;

      // Author
      const authorEl = article.querySelector(".blog-meta-primary .blog-author");
      const author = authorEl?.textContent?.trim() || null;

      // Excerpt
      const excerptEl = article.querySelector(".blog-excerpt-wrapper");
      const excerpt = excerptEl?.textContent?.trim() || null;

      // Image — Squarespace uses img.image with data-src for the full CDN URL
      // The img is inside the same article container, so it's guaranteed to
      // be the correct thumbnail for this headline.
      let imageUrl = null;
      const imgEl = article.querySelector("img.image, img");
      if (imgEl) {
        const src = imgEl.dataset?.src || imgEl.src;
        if (src && !src.startsWith("data:")) {
          imageUrl = src;
        }
      }

      results.push({
        type: "article",
        title: titleLink.textContent.trim(),
        url,
        article_date_raw: dateText,
        author,
        excerpt,
        image_url: imageUrl,
      });
    });

    return results;
  }, BASE_URL);

  // Post-process: parse dates from M/D/YY text into ISO strings
  const headlines = rawHeadlines.map((h) => ({
    ...h,
    article_date: parseLiberationDate(h.article_date_raw),
  }));

  return headlines;
}

// ─── Build output payload ───────────────────────────────────────────────────
function buildPayload(headlines, memory, scrapeTimestamp) {
  let newCount = 0;
  let updatedCount = 0;

  const enriched = headlines.map((h) => {
    const dateInfo = classifyDate(h.article_date);
    const memCheck = memory.check(h.url);

    if (memCheck.isNew) newCount++;
    else updatedCount++;

    memory.record(h);

    return {
      type: h.type,
      title: h.title,
      url: h.url,
      article_date: h.article_date,
      article_date_raw: h.article_date_raw,
      author: h.author,
      excerpt: h.excerpt,
      date_analysis: dateInfo,
      is_new: memCheck.isNew,
      first_seen: memCheck.isNew ? scrapeTimestamp : memCheck.firstSeen,
    };
  });

  return {
    meta: {
      scrape_id: crypto.randomUUID(),
      scraped_at: scrapeTimestamp,
      source_url: TARGET_URL,
      scraper_version: "1.0.0",
      total_headlines: enriched.length,
      new_headlines: newCount,
      previously_seen: updatedCount,
    },
    headlines: enriched,
  };
}

// ─── Save scraped data ──────────────────────────────────────────────────────
function savePayload(payload) {
  const ts = payload.meta.scraped_at.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const filename = `scrape_${ts}.json`;
  const filepath = path.join(SCRAPES_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  log("info", `Saved scrape to ${filepath}`);

  // Also maintain a "latest.json" symlink/copy for easy access
  const latestPath = path.join(DATA_DIR, "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
  log("info", `Updated latest.json`);

  return filepath;
}

// ─── Retry wrapper ──────────────────────────────────────────────────────────
async function withRetry(fn, label, retries = CONFIG.retries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      log("warn", `${label} — attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      log("info", `Retrying in ${CONFIG.retryDelay}ms...`);
      await new Promise((r) => setTimeout(r, CONFIG.retryDelay));
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const scrapeTimestamp = new Date().toISOString();
  log("info", "═══════════════════════════════════════════════════════");
  log("info", "Liberation Times Scraper starting...");
  log("info", `Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"} | Headless: ${CONFIG.headless}`);

  const memory = new Memory(MEMORY_FILE);
  memory.resetSessionStats();
  log("info", `Memory loaded: ${Object.keys(memory.data.seen_hashes).length} headlines tracked, ${memory.data.total_scrapes} past scrapes`);

  // Browser launch options
  const launchOpts = {
    headless: CONFIG.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };

  if (CONFIG.proxy) {
    launchOpts.proxy = CONFIG.proxy;
    log("info", `Proxy: ${CONFIG.proxy.server}`);
  }

  let browser;
  try {
    browser = await withRetry(
      () => chromium.launch(launchOpts),
      "Browser launch"
    );

    const context = await browser.newContext({
      userAgent: CONFIG.userAgent,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
      javaScriptEnabled: true,
    });

    // Anti-detection: override navigator.webdriver
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    const page = await context.newPage();

    // Block heavy resources we don't need (images, fonts, media)
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    log("info", `Navigating to ${TARGET_URL}...`);

    await withRetry(async () => {
      await page.goto(TARGET_URL, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.timeout,
      });
    }, "Page navigation");

    // Wait a beat for any JS-rendered content
    await page.waitForTimeout(2000);

    // Scroll down to trigger any lazy-loaded content (Squarespace lazy-loads)
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 8; i++) {
        window.scrollBy(0, window.innerHeight);
        await delay(500);
      }
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(1000);

    log("info", "Page loaded. Extracting headlines...");

    const headlines = await scrapeHeadlines(page);
    log("info", `Extracted ${headlines.length} headlines`);

    if (headlines.length === 0) {
      log("warn", "No headlines found! The page structure may have changed.");
      log("warn", "Saving page snapshot for debugging...");
      const debugPath = path.join(DATA_DIR, "debug_snapshot.html");
      const html = await page.content();
      fs.writeFileSync(debugPath, html);
      log("info", `Debug snapshot saved to ${debugPath}`);
    }

    const payload = buildPayload(headlines, memory, scrapeTimestamp);

    // Log summary
    log("info", "─── Scrape Summary ───");
    log("info", `  Total headlines: ${payload.meta.total_headlines}`);
    log("info", `  New (first time): ${payload.meta.new_headlines}`);
    log("info", `  Previously seen:  ${payload.meta.previously_seen}`);

    if (CONFIG.dryRun) {
      log("info", "DRY RUN — not saving. Preview:");
      console.log(JSON.stringify(payload, null, 2));
    } else {
      const savedPath = savePayload(payload);
      memory.recordScrapeRun();
      memory.save();
      log("info", `Memory updated and saved (${Object.keys(memory.data.seen_hashes).length} total headlines tracked)`);
      log("info", `Scrape file: ${savedPath}`);
    }

    log("info", "Done ✓");

    await browser.close();
  } catch (err) {
    log("error", `Fatal error: ${err.message}`);
    log("error", err.stack);
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
