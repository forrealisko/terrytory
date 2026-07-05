/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY AI TOPIC RATER v2 — niche-aware                   ║
 * ║  Reads a niche's latest digest → fetches body text →         ║
 * ║  rates each topic 1-10 → saves picks (>= threshold).         ║
 * ║                                                              ║
 * ║  Usage: node rate-scrapes.mjs --niche ufo                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CONFIG, getRatingPrompt } from "./content-config.mjs";
import { cliNiche, getNicheContext, getApiKey, parseModelJson } from "./pipeline-core.mjs";

const ctx = getNicheContext(cliNiche());
const { log, paths, niche } = ctx;

async function fetchArticleBody(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();

    let bodyText = "";
    try {
      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);
      $("script, style, nav, footer, header, aside, .sidebar, .comments, .ad, .advertisement, .social-share, .related-posts").remove();
      const selectors = ["article", '[role="article"]', ".post-content", ".entry-content", ".article-content", ".article-body", "main", ".content"];
      for (const sel of selectors) {
        const el = $(sel);
        if (el.length > 0) {
          bodyText = el.text().trim();
          if (bodyText.length > 200) break;
        }
      }
      if (bodyText.length < 200) {
        bodyText = $("p").map((_, el) => $(el).text()).get().join("\n\n");
      }
    } catch {
      const paragraphs = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      bodyText = paragraphs
        .map((p) => p.replace(/<[^>]+>/g, "").trim())
        .filter((t) => t.length > 20)
        .join("\n\n");
    }

    if (bodyText.length > CONFIG.max_source_text_chars) {
      bodyText = bodyText.slice(0, CONFIG.max_source_text_chars) + "...";
    }
    return bodyText || null;
  } catch {
    return null;
  }
}

function groupByTopic(articles) {
  if (articles.length === 0) return [];
  const groups = [];
  const used = new Set();

  const getWords = (title) =>
    title.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3);

  function similarity(a, b) {
    const wordsA = new Set(getWords(a));
    const wordsB = new Set(getWords(b));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.min(wordsA.size, wordsB.size);
  }

  for (let i = 0; i < articles.length; i++) {
    if (used.has(i)) continue;
    const group = [articles[i]];
    used.add(i);
    for (let j = i + 1; j < articles.length; j++) {
      if (used.has(j)) continue;
      if (similarity(articles[i].title, articles[j].title) > 0.4) {
        group.push(articles[j]);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

async function rateTopic(group, sourceTexts, apiKey) {
  const sourcesDescription = group
    .map((a, i) => {
      const body = sourceTexts[i] || "(No text content extracted)";
      return `[Source ${i + 1}] Title: "${a.title}"\nURL: ${a.url}\n\nContent:\n${body}\n`;
    })
    .join("\n---\n");

  const response = await fetch(CONFIG.openrouter_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://sys.terrytory.com",
      "X-Title": "Terrytory AI Rater",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CONFIG.rating_model,
      messages: [{ role: "user", content: getRatingPrompt(niche, sourcesDescription) }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${data.error?.message || JSON.stringify(data)}`);
  }
  return parseModelJson(data.choices?.[0]?.message?.content);
}

function getExistingPickUrls() {
  const urls = new Set();
  const scanDir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        for (const a of data.source_articles || data.articles || []) {
          if (a.url) urls.add(a.url);
        }
      } catch {}
    }
  };
  scanDir(paths.picks);
  scanDir(paths.drafts);
  scanDir(paths.published);
  scanDir(paths.rejected);
  return urls;
}

async function main() {
  log("info", "═══════════════════════════════════════════════════════");
  log("info", `AI Topic Rater starting — niche: ${niche.id}`);

  if (!fs.existsSync(paths.latestDigest)) {
    log("error", `Digest file not found at ${paths.latestDigest}`);
    return;
  }

  const digest = JSON.parse(fs.readFileSync(paths.latestDigest, "utf-8"));
  const articles = digest.articles || [];
  log("info", `Loaded ${articles.length} article(s) from latest digest`);
  if (articles.length === 0) return log("info", "No articles to process.");

  const processedUrls = getExistingPickUrls();
  const unprocessed = articles.filter((a) => !processedUrls.has(a.url));
  log("info", `${unprocessed.length} new article(s) after deduplication (${processedUrls.size} already processed)`);
  if (unprocessed.length === 0) return log("info", "All articles from this digest already processed.");

  const groups = groupByTopic(unprocessed);
  log("info", `Grouped new articles into ${groups.length} topic(s)`);

  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (err) {
    return log("error", `API Key error: ${err.message}`);
  }

  let saved = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    log("info", `─── Rating topic ${i + 1}/${groups.length} ───`);
    log("info", `  Title: "${group[0].title}" (${group.length} source[s])`);

    try {
      const sourceTexts = await Promise.all(group.map((a) => fetchArticleBody(a.url)));
      const ratingResult = await rateTopic(group, sourceTexts, apiKey);
      const score = parseFloat(ratingResult.rating);
      log("info", `  AI Rating: ${score}/10 | Headline: "${ratingResult.headline}"`);
      log("info", `  Reason: ${ratingResult.reasoning}`);

      if (score >= CONFIG.rating_threshold) {
        const id = crypto.randomUUID();
        const pickData = {
          id,
          niche: niche.id,
          created_at: new Date().toISOString(),
          status: "pending",
          headline: ratingResult.headline,
          rating: score,
          reasoning: ratingResult.reasoning,
          summary: ratingResult.summary,
          source_articles: group.map((a) => ({
            source_id: a.source_id,
            source_name: a.source_name,
            title: a.title,
            url: a.url,
            excerpt: a.excerpt || undefined,
          })),
        };
        fs.writeFileSync(path.join(paths.picks, `${id}.json`), JSON.stringify(pickData, null, 2));
        log("info", `  ✓ Saved as pick`);
        saved++;
      } else {
        log("info", `  Discarded (rating ${score} < threshold ${CONFIG.rating_threshold})`);
      }
    } catch (err) {
      log("error", `  ✗ Failed to rate topic: ${err.message}`);
    }

    if (i < groups.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }

  log("info", `Processed ${groups.length} topic(s). Saved ${saved} pick(s) >= ${CONFIG.rating_threshold}.`);
  log("info", "Topic Rater complete ✓");
}

main().catch((err) => {
  log("error", `Unhandled rater error: ${err.message}`);
  process.exit(1);
});
