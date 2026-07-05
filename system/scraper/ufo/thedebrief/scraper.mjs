/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  THE DEBRIEF — HEADLINE SCRAPER v1.0                        ║
 * ║  Smart, robust, memory-aware scraper for homepage headlines  ║
 * ║  Proxy-ready • Deduplication • Incremental • Date-aware      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Site architecture: WordPress theme "15zine" by CodeTipi.
 *
 * TWO distinct article layouts on the homepage:
 *
 * 1. FEATURED GRID (hero section, top of page):
 *    Container:  article.preview-grid
 *    Title:      h2.title > a[href]         (or just .cb-article-meta h2.title a)
 *    Date:       NOT present in grid articles (no <time> element)
 *    URL:        h2.title > a[href]         (or a.mask-img)
 *    Categories: Extracted from article class names (category-*, tag-*)
 *
 * 2. CLASSIC LIST (main feed below the grid):
 *    Container:  article.preview-classic
 *    Title:      h2.title.cb-post-title > a[href]
 *    Date:       time.entry-date[datetime]   (ISO format in datetime attr)
 *    Author:     .byline-part.author a
 *    Excerpt:    div.excerpt
 *    URL:        h2.title > a[href]          (or a.mask-img)
 *    Categories: Extracted from article class names (category-*, tag-*)
 *
 * Key insight: grid articles have NO dates or excerpts. Classic articles
 * have full metadata. Both have rich category/tag data in CSS classes.
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

const TARGET_URL = "https://thedebrief.org/";

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
    const tmp = this.filepath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filepath);
  }

  check(url) {
    const hash = this._hash(url);
    if (this.data.seen_hashes[hash]) {
      return { isNew: false, firstSeen: this.data.seen_hashes[hash].first_seen };
    }
    return { isNew: true };
  }

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
function classifyDate(isoDateStr) {
  if (!isoDateStr) return { relative: "unknown", age_days: null, parsed: null };

  const articleDate = new Date(isoDateStr);
  const now = new Date();
  const diffMs = now - articleDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let relative;
  if (diffDays < 0) {
    relative = "future";
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

// ─── Category Extraction ────────────────────────────────────────────────────
// The Debrief encodes rich category/tag data in the article's CSS classes.
// e.g. "category-breaking-news category-physics tag-exotic-particle tag-physics"
function extractCategories(classStr) {
  if (!classStr) return { categories: [], tags: [] };

  const classes = classStr.split(/\s+/);
  const categories = [];
  const tags = [];

  for (const cls of classes) {
    if (cls.startsWith("category-")) {
      categories.push(cls.replace("category-", "").replace(/-/g, " "));
    } else if (cls.startsWith("tag-")) {
      tags.push(cls.replace("tag-", "").replace(/-/g, " "));
    }
  }

  return { categories, tags };
}

// ─── Scraping Engine ────────────────────────────────────────────────────────
async function scrapeHeadlines(page) {
  log("info", "Extracting headlines from DOM...");

  const headlines = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // ── Helper: extract best image URL from an article container ──
    function getImageUrl(article) {
      const img = article.querySelector("img.wp-post-image, img");
      if (!img) return null;
      // Prefer actual src over data-src; skip placeholder data: URIs
      const src = img.src;
      if (src && !src.startsWith("data:")) return src;
      const dataSrc = img.dataset?.src;
      if (dataSrc && !dataSrc.startsWith("data:")) return dataSrc;
      return null;
    }

    // ── 1. FEATURED GRID articles ──
    // article.preview-grid — hero section at top of page
    // These have NO date, NO author, NO excerpt — just title + URL + categories + image
    document.querySelectorAll("article.preview-grid").forEach((article) => {
      const titleEl = article.querySelector("h2.title a");
      if (!titleEl) return;

      const url = titleEl.href;
      if (seen.has(url)) return;
      seen.add(url);

      results.push({
        type: "featured",
        title: titleEl.textContent.trim(),
        url,
        article_date: null,     // grid articles don't have dates
        author: null,
        excerpt: null,
        image_url: getImageUrl(article),
        article_classes: article.className,
      });
    });

    // ── 2. CLASSIC LIST articles ──
    // article.preview-classic — main feed
    // These have full metadata: date, author, excerpt
    document.querySelectorAll("article.preview-classic").forEach((article) => {
      // Title — h2.title.cb-post-title > a  or  h2.title > a
      const titleEl = article.querySelector("h2.title a");
      if (!titleEl) return;

      const url = titleEl.href;
      if (seen.has(url)) return;
      seen.add(url);

      // Date — time.entry-date[datetime]
      const timeEl = article.querySelector("time.entry-date");
      const articleDate = timeEl?.getAttribute("datetime") || null;

      // Author — .byline-part.author a
      const authorEl = article.querySelector(".byline-part.author a");
      const author = authorEl?.textContent?.trim() || null;

      // Excerpt — div.excerpt
      const excerptEl = article.querySelector("div.excerpt");
      const excerpt = excerptEl?.textContent?.trim() || null;

      // Determine sub-type: "preview-2 stack" = highlighted, "split" = standard
      const isHighlighted = article.classList.contains("preview-2");

      results.push({
        type: isHighlighted ? "highlighted" : "article",
        title: titleEl.textContent.trim(),
        url,
        article_date: articleDate,
        author,
        excerpt,
        image_url: getImageUrl(article),
        article_classes: article.className,
      });
    });

    return results;
  });

  // Post-process: extract categories from class names
  return headlines.map((h) => {
    const { categories, tags } = extractCategories(h.article_classes);
    const { article_classes, ...rest } = h; // strip raw classes from output
    return { ...rest, categories, tags };
  });
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
      ...h,
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
      featured_count: enriched.filter((h) => h.type === "featured").length,
      highlighted_count: enriched.filter((h) => h.type === "highlighted").length,
      article_count: enriched.filter((h) => h.type === "article").length,
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
  log("info", "The Debrief Scraper starting...");
  log("info", `Mode: ${CONFIG.dryRun ? "DRY RUN" : "LIVE"} | Headless: ${CONFIG.headless}`);

  const memory = new Memory(MEMORY_FILE);
  memory.resetSessionStats();
  log("info", `Memory loaded: ${Object.keys(memory.data.seen_hashes).length} headlines tracked, ${memory.data.total_scrapes} past scrapes`);

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

    // Block heavy resources (images, fonts, media) but KEEP stylesheets
    // because The Debrief uses lazy-loading that might depend on CSS
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
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

    // Wait for JS-rendered content
    await page.waitForTimeout(2000);

    // Scroll aggressively — The Debrief loads articles via lazy-load
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 10; i++) {
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
    log("info", `  Total headlines:  ${payload.meta.total_headlines}`);
    log("info", `  New (first time): ${payload.meta.new_headlines}`);
    log("info", `  Previously seen:  ${payload.meta.previously_seen}`);
    log("info", `  Featured (grid):  ${payload.meta.featured_count}`);
    log("info", `  Highlighted:      ${payload.meta.highlighted_count}`);
    log("info", `  Articles:         ${payload.meta.article_count}`);

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
