/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  PIPELINE CORE — shared machinery for all content scripts    ║
 * ║  Niche context, logging, research, writing, images, stars.   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import { loadNiche, ensureNicheDirs } from "../lib/niches.mjs";
import { loadEnv, getOpenRouterKey } from "../lib/env.mjs";
import { CONFIG, getEditorialPrompt, getResearchPrompt } from "./content-config.mjs";

loadEnv();

// ─── Niche context ───────────────────────────────────────────────────────────
export function cliNiche(fallback = "ai") {
  const idx = process.argv.indexOf("--niche");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.NICHE || fallback;
}

export function getNicheContext(nicheId) {
  const niche = loadNiche(nicheId);
  const paths = ensureNicheDirs(nicheId);
  const log = makeLogger(paths);
  return { niche, paths, log };
}

function makeLogger(paths) {
  return function log(level, msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${msg}`;
    console.log(line);
    try {
      fs.appendFileSync(paths.generatorLog, line + "\n");
    } catch {}
    try {
      fs.appendFileSync(paths.orchestratorLog, line + "\n");
    } catch {}
  };
}

export function getApiKey() {
  return getOpenRouterKey();
}

// ─── OpenRouter helpers ──────────────────────────────────────────────────────
async function openrouter(body, apiKey, label) {
  const response = await fetch(CONFIG.openrouter_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://sys.terrytory.com",
      "X-Title": `Terrytory ${label}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${label} API error: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

export function parseModelJson(raw) {
  try {
    return JSON.parse(raw.trim());
  } catch {
    const match = raw.match(/({[\s\S]*})/);
    if (match) return JSON.parse(match[1]);
    throw new Error("Could not parse JSON output from model.");
  }
}

// ─── Style guide: recent published articles as few-shot examples ─────────────
export function getFewShotExamples(ctx) {
  try {
    const dir = ctx.paths.published;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return "";
    files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);

    const examples = [];
    for (const f of files.slice(0, 3)) {
      try {
        const art = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        examples.push(`--- EXAMPLE PUBLISHED ARTICLE ---
Title: ${art.selected_headline || art.headline_options?.[0]}
Excerpt: ${art.excerpt}
Body:
${art.body_markdown}
`);
      } catch {}
    }
    return examples.join("\n\n");
  } catch {
    return "";
  }
}

// ─── Research (online search model) ──────────────────────────────────────────
export async function performResearch(ctx, headline, sourceArticles, apiKey) {
  ctx.log("info", `  [Research] "${headline}"`);
  const sourcesText = sourceArticles
    .map((s, i) => `[Source ${i + 1}] Title: "${s.title}" (URL: ${s.url})`)
    .join("\n");

  const data = await openrouter(
    {
      model: CONFIG.perplexity_model,
      messages: [{ role: "user", content: getResearchPrompt(ctx.niche, headline, sourcesText) }],
      temperature: 0.2,
    },
    apiKey,
    "Research Agent"
  );
  return data.choices?.[0]?.message?.content || "";
}

// ─── Writer ──────────────────────────────────────────────────────────────────
export async function writeArticleDraft(ctx, pick, researchReport, styleGuide, apiKey, modelOverride, format) {
  const model = modelOverride || CONFIG.model;
  ctx.log("info", `  [Writer] Generating ${format || "article"} draft via ${model}...`);

  const sourceContext = pick.source_articles
    .map((s, i) => `[Source ${i + 1}] Title: "${s.title}" (URL: ${s.url})\nExcerpt: ${s.excerpt || "N/A"}`)
    .join("\n\n");

  const brand = ctx.niche.brand?.name || "TERRYTORY";
  const angleNote = pick.angle ? `\n\nEDITORIAL ANGLE (the specific take to write toward):\n${pick.angle}\n` : "";
  const prompt = `${getEditorialPrompt(ctx.niche, { format })}${angleNote}

──────────────────────────────
WRITING STYLE GUIDELINES (Use these past articles to copy the tone, vocabulary, formatting, and style):
──────────────────────────────
${styleGuide || "No past articles available. Write in a confident, authoritative style appropriate for the publication."}

──────────────────────────────
WEB RESEARCH REPORT (Factual grounding):
──────────────────────────────
${researchReport}

──────────────────────────────
ORIGINAL SOURCE FEED ARTICLES:
──────────────────────────────
${sourceContext}

──────────────────────────────

Write an original, premium article for ${brand} based on the Research Report and Source Feed articles. Ensure your tone matches the style guide examples. Output valid JSON only.`;

  const startTime = Date.now();
  const data = await openrouter(
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    },
    apiKey,
    "Writer Agent"
  );

  const articleJson = parseModelJson(data.choices?.[0]?.message?.content);
  return {
    ...articleJson,
    generation: {
      model: data.model || model,
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      generation_time_ms: Date.now() - startTime,
    },
  };
}

// ─── Image generation ────────────────────────────────────────────────────────
export async function generateAndSaveImage(ctx, prompt, filename) {
  loadEnv();
  const falKey = process.env.FAL_KEY;
  const fullPrompt = `Editorial news photography style. ${prompt}. High contrast, dramatic lighting, cinematic composition. No text or watermarks.`;
  let imageUrl = "";

  if (falKey) {
    const response = await fetch("https://fal.run/fal-ai/flux/dev", {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: fullPrompt, image_size: "landscape_16_9" }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Fal.ai failed");
    imageUrl = data.images?.[0]?.url;
  } else {
    const response = await fetch("https://openrouter.ai/api/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sys.terrytory.com",
        "X-Title": "Terrytory Content Generator",
      },
      body: JSON.stringify({
        model: CONFIG.image_model,
        prompt: fullPrompt,
        n: 1,
        size: "1792x1024",
        quality: "standard",
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Image generation failed");
    imageUrl = data.data?.[0]?.url;
  }

  if (!imageUrl) throw new Error("No image URL returned");
  const imageRes = await fetch(imageUrl);
  const buffer = Buffer.from(await imageRes.arrayBuffer());
  fs.writeFileSync(path.join(ctx.paths.images, filename), buffer);
  return `/api/content/images/${filename}`;
}

export function insertInlineImages(bodyMarkdown, inlineImages, draftId) {
  if (!inlineImages || inlineImages.length === 0) return bodyMarkdown;
  const paragraphs = bodyMarkdown.split(/\n\n+/);
  const sorted = [...inlineImages].sort((a, b) => b.paragraph_index - a.paragraph_index);

  for (const img of sorted) {
    let idx = Math.min(Math.max(img.paragraph_index, 0), paragraphs.length - 1);
    const originalIndex = inlineImages.indexOf(img);
    paragraphs.splice(idx, 0, `![${img.caption || "Image"}](/api/content/images/inline-${draftId}-${originalIndex}.webp)`);
  }
  return paragraphs.join("\n\n");
}

// ─── Core: spec → draft (research + write + images + save) ──────────────────
// `spec` is a pick-like object: { id, headline, source_articles, angle? }.
// Format-aware and side-effect-free (does NOT touch pick files) so both the
// pick flow and the Creative Director's ideas can share it.
export async function generateDraft(ctx, spec, apiKey, { modelOverride = null, withImages = true, format = "article" } = {}) {
  const researchReport = await performResearch(ctx, spec.headline, spec.source_articles, apiKey);
  ctx.log("info", `  Research complete (${researchReport.length} chars)`);

  const styleGuide = getFewShotExamples(ctx);
  const draftContent = await writeArticleDraft(ctx, spec, researchReport, styleGuide, apiKey, modelOverride, format);
  // AI now commits to a single best headline; keep backward-compat with older `headline_options`.
  const finalHeadline =
    draftContent.headline || draftContent.headline_options?.[0] || spec.headline;
  ctx.log("info", `  ✓ ${format} generated: "${finalHeadline}"`);

  const draftId = spec.id;

  if (withImages && draftContent.inline_images?.length) {
    ctx.log("info", `  Generating ${draftContent.inline_images.length} inline image(s)...`);
    for (let i = 0; i < draftContent.inline_images.length; i++) {
      try {
        await generateAndSaveImage(ctx, draftContent.inline_images[i].prompt, `inline-${draftId}-${i}.webp`);
      } catch (e) {
        ctx.log("error", `  ✗ Inline image ${i + 1} failed: ${e.message}`);
      }
    }
    draftContent.body_markdown = insertInlineImages(draftContent.body_markdown, draftContent.inline_images, draftId);
  }

  const draftData = {
    id: draftId,
    niche: ctx.niche.id,
    created_at: new Date().toISOString(),
    status: "draft",
    format,
    source_articles: spec.source_articles,
    headline: finalHeadline,
    headline_options: [finalHeadline],
    selected_headline: finalHeadline,
    slug: draftContent.slug || spec.id,
    body_markdown: draftContent.body_markdown || "",
    excerpt: draftContent.excerpt || "",
    seo: draftContent.seo || { meta_title: "", meta_description: "", keywords: [] },
    hero_image_prompt: draftContent.hero_image_prompt || null,
    affiliate_slots: draftContent.affiliate_slots || [],
    generation: draftContent.generation,
  };

  fs.writeFileSync(path.join(ctx.paths.drafts, `${draftId}.json`), JSON.stringify(draftData, null, 2));
  ctx.log("info", `  ✓ Draft saved: ${draftId}.json`);
  return draftData;
}

// ─── Full pick → draft flow (draft + mark pick + archive stars) ─────────────
export async function generateDraftFromPick(ctx, pick, apiKey, { modelOverride = null, withImages = true } = {}) {
  const draftData = await generateDraft(ctx, pick, apiKey, { modelOverride, withImages, format: pick.format || "article" });

  // Mark pick as picked
  const pickPath = path.join(ctx.paths.picks, `${pick.id}.json`);
  const cleanPick = { ...pick, status: "picked" };
  delete cleanPick._hasStarred;
  fs.writeFileSync(pickPath, JSON.stringify(cleanPick, null, 2));

  archiveStarsForPick(ctx, pick);
  return draftData;
}

// ─── Starred scrapes ─────────────────────────────────────────────────────────
export function readStarred(ctx) {
  try {
    return JSON.parse(fs.readFileSync(ctx.paths.starred, "utf-8"));
  } catch {
    return { active: {} };
  }
}

export function archiveStarsForPick(ctx, pick) {
  const starredData = readStarred(ctx);
  let updated = false;
  const now = new Date().toISOString();
  for (const src of pick.source_articles || []) {
    if (starredData.active?.[src.url]) {
      if (!starredData.processed) starredData.processed = {};
      starredData.processed[src.url] = { ...starredData.active[src.url], processed_at: now };
      delete starredData.active[src.url];
      updated = true;
      ctx.log("info", `  ✓ Star archived: ${src.url}`);
    }
  }
  if (updated) fs.writeFileSync(ctx.paths.starred, JSON.stringify(starredData, null, 2));
}
