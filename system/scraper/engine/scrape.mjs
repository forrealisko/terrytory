/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY SCRAPER ENGINE v2.0                               ║
 * ║  One config-driven engine for every niche and source.        ║
 * ║                                                              ║
 * ║  Usage:                                                      ║
 * ║    node scrape.mjs --niche ufo                               ║
 * ║    node scrape.mjs --niche travel --source skift             ║
 * ║    node scrape.mjs --niche ufo --no-proxy --dry-run          ║
 * ║                                                              ║
 * ║  Source types:                                               ║
 * ║    html — Playwright + declarative extraction spec           ║
 * ║    rss  — curl fetch + cheerio XML parsing                   ║
 * ║                                                              ║
 * ║  Proxy: BrightData residential (system/.env), both types.    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as cheerio from "cheerio";
import { loadNiche, ensureNicheDirs } from "../../lib/niches.mjs";
import { loadEnv, getProxy } from "../../lib/env.mjs";

loadEnv();

// ─── CLI args ────────────────────────────────────────────────────────────────
function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
  return val && !val.startsWith("--") ? val : true;
}

const NICHE_ID = arg("niche", "ufo");
const ONLY_SOURCE = arg("source");
const DRY_RUN = process.argv.includes("--dry-run");
const NO_PROXY = process.argv.includes("--no-proxy");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const niche = loadNiche(NICHE_ID);
const paths = ensureNicheDirs(NICHE_ID);
const proxy = NO_PROXY ? null : getProxy();

// ─── Logger ──────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(paths.orchestratorLog, line + "\n");
  } catch {}
}

// ─── Memory (per source, dedup across runs) ──────────────────────────────────
class Memory {
  constructor(filepath) {
    this.filepath = filepath;
    try {
      this.data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    } catch {
      this.data = {
        version: 1,
        created_at: new Date().toISOString(),
        last_scrape: null,
        total_scrapes: 0,
        seen_hashes: {},
        stats: { total_headlines_ever: 0 },
      };
    }
  }
  _hash(str) {
    return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
  }
  check(url) {
    const h = this.data.seen_hashes[this._hash(url)];
    return h ? { isNew: false, firstSeen: h.first_seen } : { isNew: true };
  }
  record(headline) {
    const hash = this._hash(headline.url);
    const now = new Date().toISOString();
    if (!this.data.seen_hashes[hash]) {
      this.data.seen_hashes[hash] = { first_seen: now, last_seen: now, title: headline.title, url: headline.url };
      this.data.stats.total_headlines_ever++;
    } else {
      this.data.seen_hashes[hash].last_seen = now;
      this.data.seen_hashes[hash].title = headline.title;
    }
  }
  finishRun() {
    this.data.last_scrape = new Date().toISOString();
    this.data.total_scrapes++;
    const tmp = this.filepath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filepath);
  }
}

// ─── Date helpers ────────────────────────────────────────────────────────────
function classifyDate(isoDateStr) {
  if (!isoDateStr) return { relative: "unknown", age_days: null, parsed: null };
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return { relative: "unknown", age_days: null, parsed: null };
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  const relative =
    diffDays < 0 ? "future"
    : diffDays === 0 ? "today"
    : diffDays === 1 ? "yesterday"
    : diffDays <= 7 ? "this_week"
    : diffDays <= 30 ? "this_month"
    : diffDays <= 365 ? "this_year"
    : "older";
  return { relative, age_days: diffDays, parsed: d.toISOString() };
}

/** Parse "6/17/26" style dates (Squarespace) into ISO. */
function parseMdyShort(text) {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── HTML source: generic Playwright extraction ─────────────────────────────
/**
 * Runs inside the browser. `spec` is the source's scrape config.
 * Supports two item modes:
 *   container — iterate container elements, extract fields within each
 *   links     — iterate link elements, use closest() ancestor for context
 */
function domExtractor(spec) {
  const results = [];
  const seen = new Set();

  function getImage(el, walkUp = 0) {
    let node = el;
    for (let lvl = 0; lvl <= walkUp && node; lvl++) {
      const bgSpan = node.querySelector("span.img.bg-cover");
      if (bgSpan) {
        const match = bgSpan.style.backgroundImage?.match(/url\("?([^")]+)"?\)/);
        if (match?.[1]) return match[1];
      }
      const img = node.querySelector("img.wp-post-image, img.image, img");
      if (img) {
        const src = img.dataset?.src || img.src;
        if (src && !src.startsWith("data:")) return src;
      }
      node = node.parentElement;
    }
    return null;
  }

  function textOf(root, selector) {
    if (!selector) return null;
    return root.querySelector(selector)?.textContent?.trim() || null;
  }

  function dateOf(root, dateSpec) {
    if (!dateSpec) return { iso: null, raw: null };
    const el = root.querySelector(dateSpec.selector);
    if (!el) return { iso: null, raw: null };
    if (dateSpec.text) return { iso: null, raw: el.textContent?.trim() || null };
    return { iso: el.getAttribute(dateSpec.attr || "datetime"), raw: null };
  }

  function push(item) {
    if (!item.url || !item.title || seen.has(item.url)) return;
    seen.add(item.url);
    results.push(item);
  }

  for (const itemSpec of spec.items) {
    if (itemSpec.mode === "container") {
      document.querySelectorAll(itemSpec.container).forEach((container) => {
        const titleEl = container.querySelector(itemSpec.title);
        if (!titleEl) return;
        const date = dateOf(container, itemSpec.date);
        let type = itemSpec.type_label;
        if (itemSpec.highlight_class && container.classList.contains(itemSpec.highlight_class)) {
          type = "highlighted";
        }
        push({
          type,
          title: titleEl.textContent.trim(),
          url: titleEl.href,
          article_date: date.iso,
          article_date_raw: date.raw,
          author: textOf(container, itemSpec.author),
          excerpt: textOf(container, itemSpec.excerpt),
          image_url: getImage(container, itemSpec.image_walk_up || 0),
          article_classes: spec.wp_categories ? container.className : null,
        });
      });
    } else if (itemSpec.mode === "links") {
      document.querySelectorAll(itemSpec.links).forEach((linkEl) => {
        const context = itemSpec.closest ? linkEl.closest(itemSpec.closest) : null;
        const date = context ? dateOf(context, itemSpec.date) : { iso: null, raw: null };
        push({
          type: itemSpec.type_label,
          title: linkEl.textContent.trim(),
          url: linkEl.href,
          article_date: date.iso,
          article_date_raw: date.raw,
          author: context ? textOf(context, itemSpec.author) : null,
          excerpt: context ? textOf(context, itemSpec.excerpt) : null,
          image_url: context ? getImage(context, 0) : null,
          article_classes: null,
        });
      });
    }
  }

  return results;
}

/** WordPress themes encode categories/tags in CSS classes. */
function extractWpCategories(classStr) {
  if (!classStr) return { categories: [], tags: [] };
  const categories = [];
  const tags = [];
  for (const cls of classStr.split(/\s+/)) {
    if (cls.startsWith("category-")) categories.push(cls.slice(9).replace(/-/g, " "));
    else if (cls.startsWith("tag-")) tags.push(cls.slice(4).replace(/-/g, " "));
  }
  return { categories, tags };
}

async function scrapeHtmlSource(source, chromium) {
  const spec = source.scrape;
  const launchOpts = {
    headless: process.env.HEADLESS !== "false",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };
  if (proxy) {
    launchOpts.proxy = { server: proxy.server, username: proxy.username, password: proxy.password };
  }

  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
      ignoreHTTPSErrors: true, // BrightData MITM cert
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const page = await context.newPage();
    // Block heavy resources — saves residential proxy bandwidth too
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) route.abort();
      else route.continue();
    });

    await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Some sites fire a late JS redirect/reload that destroys the eval
    // context mid-scroll — retry the settle+scroll+extract phase once.
    let raw;
    for (let attempt = 1; ; attempt++) {
      try {
        await page.waitForTimeout(spec.settle_ms ?? 2000);
        const passes = spec.scroll_passes ?? 8;
        await page.evaluate(async (n) => {
          const delay = (ms) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < n; i++) {
            window.scrollBy(0, window.innerHeight);
            await delay(400);
          }
          window.scrollTo(0, 0);
        }, passes);
        await page.waitForTimeout(1000);
        raw = await page.evaluate(domExtractor, spec);
        break;
      } catch (err) {
        if (attempt >= 3 || !/context was destroyed|navigation/i.test(err.message)) throw err;
        log("warn", `  ${source.name}: page navigated mid-extract, retrying (${attempt}/2)...`);
        await page.waitForLoadState("domcontentloaded").catch(() => {});
      }
    }

    return raw.map((h) => {
      const { article_classes, ...rest } = h;
      const wp = spec.wp_categories ? extractWpCategories(article_classes) : { categories: [], tags: [] };
      let articleDate = h.article_date;
      if (!articleDate && h.article_date_raw && spec.date_parse === "mdy-short") {
        articleDate = parseMdyShort(h.article_date_raw);
      }
      return { ...rest, article_date: articleDate, categories: wp.categories, tags: wp.tags };
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── RSS source: curl + cheerio ──────────────────────────────────────────────
function fetchViaCurl(url, useProxy) {
  const args = ["-sL", "--max-time", "30", "-A", USER_AGENT];
  if (useProxy && proxy) {
    args.push("--proxy", `${proxy.host}:${proxy.port}`);
    args.push("--proxy-user", `${proxy.username}:${proxy.password}`);
    args.push("-k"); // BrightData cert
  }
  args.push(url);
  return execFileSync("curl", args, { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
}

/**
 * Fetch with proxy, fall back to direct when BrightData refuses the site
 * (some domains are blocked in no-KYC residential mode) or the response
 * isn't a feed at all.
 */
function fetchFeed(url) {
  if (proxy) {
    const body = fetchViaCurl(url, true);
    const looksBlocked = body.includes("Residential Failed") || body.includes("brd_error");
    const looksLikeFeed = /<(rss|feed|\?xml)/i.test(body.slice(0, 500));
    if (!looksBlocked && looksLikeFeed) return { body, via: "proxy" };
    log("warn", `  Proxy refused/garbled ${url} — falling back to direct fetch`);
  }
  return { body: fetchViaCurl(url, false), via: "direct" };
}

function stripHtml(html) {
  if (!html) return null;
  const text = cheerio.load(`<div>${html}</div>`)("div").text().replace(/\s+/g, " ").trim();
  return text || null;
}

function scrapeRssSource(source) {
  const { body: xml, via } = fetchFeed(source.url);
  if (via === "direct" && proxy) log("info", `  (${source.name} fetched direct)`);
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = $("item").length ? $("item") : $("entry"); // RSS 2.0 or Atom

  const results = [];
  items.each((_, el) => {
    const $el = $(el);
    let url = $el.find("link").first().text().trim();
    if (!url) url = $el.find("link").first().attr("href") || ""; // Atom
    const title = $el.find("title").first().text().trim();
    if (!url || !title) return;

    const pubDate = $el.find("pubDate").first().text() || $el.find("published, updated").first().text();
    const parsed = pubDate ? new Date(pubDate) : null;
    const articleDate = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null;

    const description = $el.find("description").first().text() || $el.find("summary").first().text();
    let excerpt = stripHtml(description);
    if (excerpt && excerpt.length > 400) excerpt = excerpt.slice(0, 400) + "…";

    const author = $el.find("dc\\:creator").first().text().trim() || $el.find("author name").first().text().trim() || null;
    const categories = $el
      .find("category")
      .map((_, c) => $(c).text().trim() || $(c).attr("term") || "")
      .get()
      .filter(Boolean)
      .slice(0, 8);

    const image =
      $el.find("media\\:content").first().attr("url") ||
      $el.find("media\\:thumbnail").first().attr("url") ||
      $el.find("enclosure[type^='image']").first().attr("url") ||
      null;

    results.push({
      type: "article",
      title,
      url,
      article_date: articleDate,
      article_date_raw: null,
      author,
      excerpt,
      image_url: image,
      categories,
      tags: [],
    });
  });

  return results;
}

// ─── Per-source run: scrape → enrich with memory → save latest.json ─────────
async function runSource(source, chromium, scrapeTimestamp) {
  const sourceDir = paths.sourceData(source.id);
  fs.mkdirSync(path.join(sourceDir, "scrapes"), { recursive: true });
  const memory = new Memory(path.join(sourceDir, "memory.json"));

  const start = Date.now();
  const rawHeadlines =
    source.type === "rss" ? scrapeRssSource(source) : await scrapeHtmlSource(source, chromium);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Cap to newest N per source so high-volume feeds (e.g. arXiv lists hundreds)
  // don't flood the pipeline and the AI rater. Override per source via
  // scrape.max_items (set 0 to disable the cap). Feeds/pages are newest-first.
  const maxItems = source.scrape?.max_items ?? 40;
  const headlines = maxItems > 0 ? rawHeadlines.slice(0, maxItems) : rawHeadlines;

  let newCount = 0;
  const enriched = headlines.map((h) => {
    const memCheck = memory.check(h.url);
    if (memCheck.isNew) newCount++;
    memory.record(h);
    return {
      ...h,
      date_analysis: classifyDate(h.article_date),
      is_new: memCheck.isNew,
      first_seen: memCheck.isNew ? scrapeTimestamp : memCheck.firstSeen,
    };
  });

  const payload = {
    meta: {
      scrape_id: crypto.randomUUID(),
      scraped_at: scrapeTimestamp,
      source_url: source.url,
      source_type: source.type,
      scraper_version: "2.0.0",
      proxy: proxy ? "brightdata-residential" : "direct",
      total_headlines: enriched.length,
      new_headlines: newCount,
      previously_seen: enriched.length - newCount,
    },
    headlines: enriched,
  };

  if (!DRY_RUN) {
    const ts = scrapeTimestamp.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    fs.writeFileSync(path.join(sourceDir, "scrapes", `scrape_${ts}.json`), JSON.stringify(payload, null, 2));
    fs.writeFileSync(path.join(sourceDir, "latest.json"), JSON.stringify(payload, null, 2));
    memory.finishRun();
  }

  log("info", `  ${source.name}: ${enriched.length} headlines (${newCount} new) in ${elapsed}s`);
  return { payload, elapsed };
}

// ─── Digest: merge NEW articles across sources ───────────────────────────────
function buildDigest(runResults, runAt) {
  const allNew = [];
  for (const source of niche.sources) {
    const result = runResults[source.id];
    if (!result?.ok) continue;
    for (const h of result.payload.headlines) {
      if (!h.is_new) continue;
      allNew.push({
        source_id: source.id,
        source_name: source.name,
        type: h.type ?? "article",
        title: h.title,
        url: h.url,
        image_url: h.image_url ?? null,
        author: h.author ?? null,
        excerpt: h.excerpt ?? null,
        article_date: h.article_date ?? null,
        date_analysis: h.date_analysis ?? null,
        categories: h.categories ?? [],
        tags: h.tags ?? [],
        first_seen: h.first_seen,
      });
    }
  }

  allNew.sort((a, b) => {
    const da = a.article_date ? new Date(a.article_date).getTime() : 0;
    const db = b.article_date ? new Date(b.article_date).getTime() : 0;
    return db - da;
  });

  return {
    meta: {
      digest_id: crypto.randomUUID(),
      niche: NICHE_ID,
      run_at: runAt,
      orchestrator_version: "2.0.0",
      sources_attempted: niche.sources.length,
      sources_ok: Object.values(runResults).filter((r) => r.ok).length,
      sources_failed: Object.values(runResults).filter((r) => !r.ok).length,
      total_new: allNew.length,
      run_results: Object.fromEntries(
        niche.sources.map((s) => [s.id, { ok: runResults[s.id]?.ok ?? false, elapsed: runResults[s.id]?.elapsed }])
      ),
    },
    articles: allNew,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const runAt = new Date().toISOString();
  log("info", "═══════════════════════════════════════════════════════");
  log("info", `Scraper Engine v2 — niche: ${NICHE_ID} (${niche.brand?.name || NICHE_ID})`);
  log("info", `Proxy: ${proxy ? `BrightData residential (${proxy.host})` : "DIRECT (no proxy)"}`);

  const sources = niche.sources.filter((s) => !ONLY_SOURCE || s.id === ONLY_SOURCE);
  if (sources.length === 0) {
    log("error", `No sources matched${ONLY_SOURCE ? ` --source ${ONLY_SOURCE}` : ""}.`);
    process.exit(1);
  }

  // Lazy-load playwright only if an html source is in play
  let chromium = null;
  if (sources.some((s) => s.type !== "rss")) {
    ({ chromium } = await import("playwright"));
  }

  const runResults = {};
  for (const source of sources) {
    log("info", `▶  ${source.name} (${source.type})...`);
    try {
      const { payload, elapsed } = await runSource(source, chromium, runAt);
      runResults[source.id] = { ok: true, payload, elapsed };
    } catch (err) {
      log("error", `✗  ${source.name} failed: ${err.message}`);
      runResults[source.id] = { ok: false, error: err.message };
    }
  }

  const digest = buildDigest(runResults, runAt);

  if (!DRY_RUN) {
    const ts = runAt.replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const digestPath = path.join(paths.digestsDir, `digest_${ts}.json`);
    fs.writeFileSync(digestPath + ".tmp", JSON.stringify(digest, null, 2));
    fs.renameSync(digestPath + ".tmp", digestPath);
    fs.writeFileSync(paths.latestDigest + ".tmp", JSON.stringify(digest, null, 2));
    fs.renameSync(paths.latestDigest + ".tmp", paths.latestDigest);
    log("info", `Digest saved → ${digestPath}`);
  }

  log("info", "─── Run Summary ───────────────────────────────────────");
  log("info", `  Total new articles: ${digest.meta.total_new}`);
  for (const source of sources) {
    const r = runResults[source.id];
    log("info", `  ${source.name.padEnd(22)} ${r.ok ? `✓ ${r.elapsed}s` : "✗ FAILED"}`);
  }

  // Rank ALL current headlines by interest (lightweight, title-only) so the
  // feed can be sorted by how compelling the AI thinks each story is.
  if (!DRY_RUN) {
    const rankerScript = path.resolve(paths.content, "..", "..", "rank-headlines.mjs");
    if (fs.existsSync(rankerScript)) {
      try {
        execFileSync("node", [rankerScript, "--niche", NICHE_ID], {
          cwd: path.dirname(rankerScript),
          stdio: "inherit",
        });
      } catch (err) {
        log("error", `Headline ranking failed: ${err.message}`);
      }
    }
  }

  // Trigger AI topic rating when there's new content
  if (!DRY_RUN && digest.meta.total_new > 0) {
    const raterScript = path.resolve(paths.content, "..", "..", "rate-scrapes.mjs");
    if (fs.existsSync(raterScript)) {
      log("info", "─── Triggering AI topic rating ───");
      try {
        execFileSync("node", [raterScript, "--niche", NICHE_ID], {
          cwd: path.dirname(raterScript),
          stdio: "inherit",
        });
        log("info", "Topic rating complete ✓");
      } catch (err) {
        log("error", `Topic rating failed: ${err.message}`);
      }
    }
  }

  log("info", "Engine done ✓");
  if (DRY_RUN) console.log(JSON.stringify(digest, null, 2));
}

main().catch((err) => {
  log("error", `Unhandled error: ${err.message}`);
  log("error", err.stack);
  process.exit(1);
});
