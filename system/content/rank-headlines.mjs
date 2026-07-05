/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TERRYTORY HEADLINE INTEREST RANKER — niche-aware            ║
 * ║  Lightweight, title-only pass. Runs after every scrape.      ║
 * ║  Sends ALL current headlines to a cheap analysis model and   ║
 * ║  writes an `interest_score` (0-100) back into each source's  ║
 * ║  latest.json so the feed can be sorted by how interesting    ║
 * ║  the AI thinks each article is.                              ║
 * ║                                                              ║
 * ║  Usage: node rank-headlines.mjs --niche ufo                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./content-config.mjs";
import { cliNiche, getNicheContext, getApiKey, parseModelJson } from "./pipeline-core.mjs";

const ctx = getNicheContext(cliNiche());
const { log, paths, niche } = ctx;

function sourceLatestPath(sourceId) {
  return path.join(paths.sourceData(sourceId), "latest.json");
}

/** Collect every current headline across all of the niche's sources. */
function collectHeadlines() {
  const items = [];
  for (const source of niche.sources) {
    const p = sourceLatestPath(source.id);
    if (!fs.existsSync(p)) continue;
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      continue;
    }
    (payload.headlines || []).forEach((h, idx) => {
      if (h?.title) items.push({ sourceId: source.id, idx, title: h.title });
    });
  }
  return items;
}

function buildPrompt(items) {
  const criteria = (niche.editorial?.rating_criteria || [])
    .map((c) => `- ${c}`)
    .join("\n");
  const list = items.map((it, i) => `${i}. ${it.title}`).join("\n");
  return `You are the topic-analysis engine for ${
    niche.editorial?.publication_description || "a niche publication"
  }.

Below is a numbered list of scraped article headlines. Score EACH headline from 0-100 for how interesting and worth-covering it is for this publication's audience. Consider relevance to the niche, novelty/newsworthiness, and how compelling the story sounds.

Scoring guidance for this niche:
${criteria || "- Relevance, novelty, and newsworthiness for the target audience."}

Headlines:
${list}

Respond with ONLY a JSON object of the form:
{"scores": [{"i": 0, "s": 87}, {"i": 1, "s": 42}, ...]}
Include every index exactly once. No commentary.`;
}

async function scoreHeadlines(items, apiKey) {
  const response = await fetch(CONFIG.openrouter_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://sys.terrytory.com",
      "X-Title": "Terrytory Headline Ranker",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CONFIG.rating_model,
      messages: [{ role: "user", content: buildPrompt(items) }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${data.error?.message || JSON.stringify(data)}`);
  }
  const parsed = parseModelJson(data.choices?.[0]?.message?.content);
  const scores = new Map();
  for (const row of parsed?.scores || []) {
    const i = Number(row.i);
    let s = Number(row.s);
    if (!Number.isFinite(i) || !Number.isFinite(s)) continue;
    s = Math.max(0, Math.min(100, Math.round(s)));
    scores.set(i, s);
  }
  return scores;
}

/** Write the interest scores back into each source's latest.json. */
function applyScores(items, scores) {
  const rankedAt = new Date().toISOString();
  const bySource = new Map();
  items.forEach((it, i) => {
    if (!bySource.has(it.sourceId)) bySource.set(it.sourceId, []);
    bySource.get(it.sourceId).push({ idx: it.idx, score: scores.get(i) });
  });

  let written = 0;
  for (const [sourceId, updates] of bySource) {
    const p = sourceLatestPath(sourceId);
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      continue;
    }
    for (const u of updates) {
      if (payload.headlines?.[u.idx] && typeof u.score === "number") {
        payload.headlines[u.idx].interest_score = u.score;
        payload.headlines[u.idx].ranked_at = rankedAt;
        written++;
      }
    }
    fs.writeFileSync(p + ".tmp", JSON.stringify(payload, null, 2));
    fs.renameSync(p + ".tmp", p);
  }
  return written;
}

async function main() {
  log("info", "─── Headline interest ranking ───");
  const items = collectHeadlines();
  if (items.length === 0) return log("info", "No headlines to rank.");
  log("info", `Ranking ${items.length} headline(s) via ${CONFIG.rating_model}...`);

  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (err) {
    return log("error", `API Key error: ${err.message}`);
  }

  try {
    const scores = await scoreHeadlines(items, apiKey);
    if (scores.size === 0) return log("error", "Model returned no usable scores.");
    const written = applyScores(items, scores);
    log("info", `Interest ranking complete ✓ (${written} headline[s] scored)`);
  } catch (err) {
    log("error", `Headline ranking failed: ${err.message}`);
  }
}

main().catch((err) => {
  log("error", `Unhandled ranker error: ${err.message}`);
  process.exit(1);
});
