/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  THE BLACK VAULT — HEADLINE SCRAPER v1.0                    ║
 * ║  Smart, robust, memory-aware scraper for homepage headlines  ║
 * ║  Proxy-ready • Deduplication • Incremental • Date-aware      ║
 * ╚══════════════════════════════════════════════════════════════╝
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

const TARGET_URL = "https://www.theblackvault.com/documentarchive/";

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
// Parses article dates and classifies them relative to scrape time.
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

// ─── Image Extraction Helpers ───────────────────────────────────────────────
// The Black Vault uses two image strategies:
//   1. <span class="img bg-cover wp-post-image"> with inline background-image style
//   2. <img class="wp-post-image" data-src="..."> (lazy-loaded placeholder)
// We extract the URL from the DOM attributes without actually loading the images.

function extractImageFromContainer(container) {
  if (!container) return null;

  // Strategy 1: span.img.bg-cover with background-image inline style
  const bgSpan = container.querySelector("span.img.bg-cover");
  if (bgSpan) {
    const bg = bgSpan.style.backgroundImage;
    const match = bg?.match(/url\("?([^"]+)"?\)/);
    if (match?.[1]) return match[1];
  }

  // Strategy 2: img.wp-post-image with data-src (lazy-loaded)
  const img = container.querySelector("img.wp-post-image");
  if (img) {
    const src = img.dataset?.src || img.src;
    if (src && !src.startsWith("data:")) return src;
  }

  return null;
}

// ─── Scraping Engine ────────────────────────────────────────────────────────
async function scrapeHeadlines(page) {
  log("info", "Extracting headlines from DOM...");

  const headlines = await page.evaluate(() => {
    const results = [];
    const seen = new Set(); // dedup within same page

    // ── Helper: extract image URL from a container element ──
    function getImageUrl(container) {
      if (!container) return null;

      // Strategy 1: span.img.bg-cover with inline background-image
      const bgSpan = container.querySelector("span.img.bg-cover");
      if (bgSpan) {
        const bg = bgSpan.style.backgroundImage;
        const match = bg?.match(/url\("?([^")+]+)"?\)/);
        if (match?.[1]) return match[1];
      }

      // Strategy 2: img.wp-post-image with data-src (lazy-loaded)
      const img = container.querySelector("img.wp-post-image");
      if (img) {
        const src = img.dataset?.src || img.src;
        if (src && !src.startsWith("data:")) return src;
      }

      return null;
    }

    // ── Featured / slider articles ──
    // Selector: .caption time.the-date + h3 > a.post-title
    document.querySelectorAll(".caption").forEach((caption) => {
      const timeEl = caption.querySelector("time.the-date");
      const linkEl = caption.querySelector("h3 a.post-title, h3 a");

      if (linkEl) {
        const url = linkEl.href;
        if (seen.has(url)) return;
        seen.add(url);

        // Find the image: walk up from .caption to find the slider item
        // that contains both the caption and its associated image
        let imageUrl = null;
        let parent = caption.parentElement;
        for (let lvl = 0; lvl < 4 && parent && !imageUrl; lvl++) {
          imageUrl = getImageUrl(parent);
          if (!imageUrl) parent = parent.parentElement;
        }

        results.push({
          type: "featured",
          title: linkEl.textContent.trim(),
          url,
          article_date: timeEl?.getAttribute("datetime") || null,
          image_url: imageUrl,
        });
      }
    });

    // ── Regular articles — h2.post-title, h4.post-title, h3.post-title ──
    document
      .querySelectorAll(
        "h2.post-title a, h3.post-title a, h4.post-title a, " +
        ".post-title a, " +
        "h2.is-title.post-title a, h4.is-title.post-title a"
      )
      .forEach((linkEl) => {
        const url = linkEl.href;
        if (seen.has(url)) return;
        seen.add(url);

        // Walk up to find nearest <time> element
        let timeEl = null;
        let parent = linkEl.closest("article, .post-item, .post, .listing-item, .post-content, .post-details");
        if (parent) {
          timeEl = parent.querySelector("time[datetime], time.post-date, time.the-date");
        }
        // Fallback: check previous siblings
        if (!timeEl) {
          const heading = linkEl.closest("h2, h3, h4");
          if (heading) {
            let sib = heading.previousElementSibling;
            while (sib) {
              timeEl = sib.querySelector?.("time[datetime]") || (sib.tagName === "TIME" ? sib : null);
              if (timeEl) break;
              sib = sib.previousElementSibling;
            }
          }
        }

        // Find the image: walk up from the heading to the article's l-post container
        // and extract the image scoped to that container
        let imageUrl = null;
        const heading = linkEl.closest("h2, h3, h4");
        let container = heading;
        for (let lvl = 0; lvl < 6 && container && !imageUrl; lvl++) {
          container = container.parentElement;
          if (!container) break;
          imageUrl = getImageUrl(container);
          // Guard: if this container has multiple post-title links,
          // ensure the FIRST one matches ours (prevents cross-article leakage)
          if (imageUrl) {
            const firstLink = container.querySelector("h2.post-title a, h3.post-title a, h4.post-title a, .post-title a");
            if (firstLink && firstLink !== linkEl) {
              imageUrl = null; // Wrong article scope, keep walking up
            }
          }
        }

        // Determine heading level for categorization
        const headingEl = linkEl.closest("h2, h3, h4");
        const tag = headingEl?.tagName?.toLowerCase() || "unknown";

        let type = "article";
        if (tag === "h2") type = "primary";
        else if (tag === "h3") type = "secondary";
        else if (tag === "h4") type = "tertiary";

        results.push({
          type,
          title: linkEl.textContent.trim(),
          url,
          article_date: timeEl?.getAttribute("datetime") || null,
          image_url: imageUrl,
        });
      });

    return results;
  });

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
      primary_count: enriched.filter((h) => h.type === "primary").length,
      secondary_count: enriched.filter((h) => h.type === "secondary").length,
      tertiary_count: enriched.filter((h) => h.type === "tertiary").length,
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
  log("info", "The Black Vault Scraper starting...");
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
      // Stealth: mask webdriver flag
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

    // Scroll down to trigger any lazy-loaded content
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 5; i++) {
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
    log("info", `  Featured: ${payload.meta.featured_count}`);
    log("info", `  Primary (h2): ${payload.meta.primary_count}`);
    log("info", `  Secondary (h3): ${payload.meta.secondary_count}`);
    log("info", `  Tertiary (h4): ${payload.meta.tertiary_count}`);

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
