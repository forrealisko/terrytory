/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY AI ARTICLE GENERATOR v1.0                        ║
 * ║  Reads scraped digest → fetches source content →             ║
 * ║  generates original articles via OpenRouter →                ║
 * ║  saves as drafts for editorial review.                       ║
 * ║                                                              ║
 * ║  Usage:                                                      ║
 * ║    node generate-articles.mjs                                ║
 * ║    node generate-articles.mjs --dry-run                      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { CONFIG, getEditorialPrompt } from "./content-config.mjs";

// ─── Paths ───────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIGEST_PATH = path.resolve(__dirname, CONFIG.digest_path);
const DRAFTS_DIR = path.resolve(__dirname, CONFIG.drafts_dir);
const LOG_FILE = path.join(__dirname, "generator.log");

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Ensure directories ─────────────────────────────────────────────────────
[DRAFTS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// ─── Logger ──────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

// ─── Read API key ────────────────────────────────────────────────────────────
function getApiKey() {
  // Check environment variable first
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }

  // Try reading from website .env.local
  const envPath = path.resolve(__dirname, "..", "..", "website", ".env.local");
  try {
    const envContent = fs.readFileSync(envPath, "utf-8");
    const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch {
    // fallthrough
  }

  throw new Error(
    "OPENROUTER_API_KEY not found in environment or website/.env.local"
  );
}

// ─── Fetch article body from URL ─────────────────────────────────────────────
/**
 * Fetches a source article URL and extracts the main text content.
 * Uses basic HTML parsing to get article body text.
 */
async function fetchArticleBody(url) {
  try {
    log("info", `  Fetching body: ${url}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log("warn", `  HTTP ${res.status} for ${url}`);
      return null;
    }

    const html = await res.text();

    // Try to dynamically import cheerio
    let bodyText = "";
    try {
      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);

      // Remove unwanted elements
      $(
        "script, style, nav, footer, header, aside, .sidebar, .comments, .ad, .advertisement, .social-share, .related-posts"
      ).remove();

      // Try common article containers
      const selectors = [
        "article",
        '[role="article"]',
        ".post-content",
        ".entry-content",
        ".article-content",
        ".article-body",
        ".story-body",
        "main",
        ".content",
      ];

      for (const sel of selectors) {
        const el = $(sel);
        if (el.length > 0) {
          bodyText = el.text().trim();
          if (bodyText.length > 200) break;
        }
      }

      // Fallback: get all paragraph text
      if (bodyText.length < 200) {
        bodyText = $("p")
          .map((_, el) => $(el).text())
          .get()
          .join("\n\n");
      }
    } catch {
      // Cheerio not available — basic regex extraction
      log("warn", "  cheerio not available, using regex extraction");
      const paragraphs = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      bodyText = paragraphs
        .map((p) => p.replace(/<[^>]+>/g, "").trim())
        .filter((t) => t.length > 20)
        .join("\n\n");
    }

    // Trim to max chars to avoid prompt bloat
    if (bodyText.length > CONFIG.max_source_text_chars) {
      bodyText = bodyText.slice(0, CONFIG.max_source_text_chars) + "...";
    }

    log(
      "info",
      `  Extracted ${bodyText.length} chars from ${url}`
    );
    return bodyText || null;
  } catch (err) {
    log("warn", `  Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

// ─── Group related articles by topic ─────────────────────────────────────────
/**
 * Groups articles that cover the same story.
 * Uses simple word overlap scoring on titles.
 */
function groupByTopic(articles) {
  if (articles.length === 0) return [];

  const groups = [];
  const used = new Set();

  function getWords(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);
  }

  function similarity(a, b) {
    const wordsA = new Set(getWords(a));
    const wordsB = new Set(getWords(b));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
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

// ─── Call OpenRouter for article generation ──────────────────────────────────
async function generateArticle(topicGroup, sourceTexts, apiKey) {
  const sourceContext = topicGroup
    .map((article, idx) => {
      const body = sourceTexts[idx] || "(Full text not available)";
      return `--- SOURCE ${idx + 1}: ${article.source_name || "Unknown"} ---
Title: ${article.title}
URL: ${article.url}
Date: ${article.article_date || article.first_seen || "Unknown"}
Categories: ${(article.categories || []).join(", ") || "N/A"}
Tags: ${(article.tags || []).join(", ") || "N/A"}
Excerpt: ${article.excerpt || "N/A"}

Full Text:
${body}
`;
    })
    .join("\n\n");

  const prompt = `${getEditorialPrompt()}

──────────────────────────────
SOURCE MATERIAL (${topicGroup.length} source article${topicGroup.length > 1 ? "s" : ""}):
──────────────────────────────

${sourceContext}

──────────────────────────────

Write an original article based on the source material above. Remember: respond with valid JSON ONLY.`;

  const startTime = Date.now();

  const response = await fetch(CONFIG.openrouter_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://sys.terrytory.com",
      "X-Title": "Terrytory Content Generator",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CONFIG.model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  if (!response.ok) {
    throw new Error(
      `OpenRouter error (${response.status}): ${data.error?.message || JSON.stringify(data)}`
    );
  }

  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("No content returned from model");
  }

  // Parse JSON from response (handle potential markdown code fences)
  let articleJson;
  try {
    // Try direct parse first
    articleJson = JSON.parse(rawContent);
  } catch {
    // Try extracting JSON from markdown code fence
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      articleJson = JSON.parse(jsonMatch[1].trim());
    } else {
      // Try finding JSON object in the text
      const braceStart = rawContent.indexOf("{");
      const braceEnd = rawContent.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd !== -1) {
        articleJson = JSON.parse(
          rawContent.slice(braceStart, braceEnd + 1)
        );
      } else {
        throw new Error("Could not parse JSON from model response");
      }
    }
  }

  return {
    ...articleJson,
    generation: {
      model: data.model || CONFIG.model,
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      generation_time_ms: elapsed,
    },
  };
}

// ─── Save draft to disk ─────────────────────────────────────────────────────
function saveDraft(articleData, topicGroup) {
  const id = crypto.randomUUID();
  const draft = {
    id,
    created_at: new Date().toISOString(),
    status: "draft",
    source_articles: topicGroup.map((a) => ({
      source_id: a.source_id || "unknown",
      source_name: a.source_name || "Unknown",
      title: a.title,
      url: a.url,
      excerpt: a.excerpt || undefined,
    })),
    headline_options: articleData.headline_options || [],
    slug: articleData.slug || id,
    body_markdown: articleData.body_markdown || "",
    excerpt: articleData.excerpt || "",
    seo: articleData.seo || {
      meta_title: "",
      meta_description: "",
      keywords: [],
    },
    hero_image_prompt: articleData.hero_image_prompt || null,
    generation: articleData.generation || {
      model: CONFIG.model,
      prompt_tokens: 0,
      completion_tokens: 0,
      generation_time_ms: 0,
    },
  };

  const filepath = path.join(DRAFTS_DIR, `${id}.json`);
  const tmp = filepath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(draft, null, 2));
  fs.renameSync(tmp, filepath);

  log("info", `  Draft saved: ${filepath}`);
  return draft;
}

// ─── Check for already-generated content ─────────────────────────────────────
function getExistingDraftUrls() {
  const urls = new Set();
  try {
    const files = fs
      .readdirSync(DRAFTS_DIR)
      .filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(DRAFTS_DIR, file), "utf-8");
        const draft = JSON.parse(raw);
        if (draft.source_articles) {
          for (const src of draft.source_articles) {
            if (src.url) urls.add(src.url);
          }
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  // Also check published and rejected
  for (const subdir of ["../published", "../rejected"]) {
    try {
      const dir = path.resolve(DRAFTS_DIR, subdir);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, file), "utf-8");
          const article = JSON.parse(raw);
          if (article.source_articles) {
            for (const src of article.source_articles) {
              if (src.url) urls.add(src.url);
            }
          }
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }

  return urls;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  log("info", "═══════════════════════════════════════════════════════");
  log("info", "TERRYTORY Content Generator starting");
  log("info", `Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  log("info", `Model: ${CONFIG.model}`);

  // ── Step 1: Read digest ──
  if (!fs.existsSync(DIGEST_PATH)) {
    log("error", `Digest not found at: ${DIGEST_PATH}`);
    return;
  }

  const digest = JSON.parse(fs.readFileSync(DIGEST_PATH, "utf-8"));
  const newArticles = digest.articles || [];

  log("info", `Digest contains ${newArticles.length} new article(s)`);

  if (newArticles.length === 0) {
    log("info", "No new articles to process. Done.");
    return;
  }

  // ── Step 2: Filter out already-processed articles ──
  const existingUrls = getExistingDraftUrls();
  const unprocessed = newArticles.filter(
    (a) => !existingUrls.has(a.url)
  );

  log(
    "info",
    `${unprocessed.length} unprocessed article(s) after dedup (${existingUrls.size} already processed)`
  );

  if (unprocessed.length === 0) {
    log("info", "All articles already processed. Done.");
    return;
  }

  // ── Step 3: Group by topic ──
  const groups = groupByTopic(unprocessed);
  log("info", `Grouped into ${groups.length} topic group(s)`);

  // Limit to max drafts per run
  const toProcess = groups.slice(0, CONFIG.max_drafts_per_run);
  log("info", `Processing ${toProcess.length} group(s) (max: ${CONFIG.max_drafts_per_run})`);

  if (DRY_RUN) {
    log("info", "DRY RUN — skipping generation. Groups:");
    toProcess.forEach((group, i) => {
      log(
        "info",
        `  Group ${i + 1}: ${group.map((a) => a.title).join(" | ")}`
      );
    });
    return;
  }

  // ── Step 4: Get API key ──
  let apiKey;
  try {
    apiKey = getApiKey();
    log("info", "API key loaded");
  } catch (err) {
    log("error", err.message);
    return;
  }

  // ── Step 5: Process each group ──
  let generated = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const group = toProcess[i];
    log(
      "info",
      `─── Generating article ${i + 1}/${toProcess.length} ───`
    );
    log(
      "info",
      `  Sources: ${group.map((a) => `[${a.source_name}] ${a.title}`).join("\n           ")}`
    );

    try {
      // Fetch full article text for each source in parallel
      const sourceTexts = await Promise.all(
        group.map((article) => fetchArticleBody(article.url))
      );

      // Generate via AI
      log("info", `  Calling ${CONFIG.model}...`);
      const result = await generateArticle(group, sourceTexts, apiKey);

      log(
        "info",
        `  Generated: ${result.headline_options?.[0] || "untitled"}`
      );
      log(
        "info",
        `  Stats: ${result.generation.prompt_tokens} prompt + ${result.generation.completion_tokens} completion tokens, ${(result.generation.generation_time_ms / 1000).toFixed(1)}s`
      );

      // Save draft
      const draft = saveDraft(result, group);
      log("info", `  ✓ Draft ${draft.id} saved`);
      generated++;
    } catch (err) {
      log("error", `  ✗ Failed: ${err.message}`);
      if (err.stack) log("error", `  ${err.stack}`);
    }

    // Small delay between API calls
    if (i < toProcess.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── Summary ──
  log("info", "─── Generation Summary ────────────────────────────────");
  log(
    "info",
    `  Generated: ${generated}/${toProcess.length} article(s)`
  );
  log("info", "Content Generator done ✓");
}

main().catch((err) => {
  log("error", `Unhandled error: ${err.message}`);
  log("error", err.stack);
  process.exit(1);
});
