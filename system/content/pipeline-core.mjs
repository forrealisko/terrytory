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
import { authorForFormat, authorByline } from "./authors.mjs";
import { collectSocialEmbeds } from "./social-embeds.mjs";

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

/**
 * Generous on purpose. These calls are genuinely slow and wildly variable — the
 * same model and prompt has taken 15s once and 128s minutes later — so a tight
 * timeout would abort work that was going to succeed, after we'd already paid
 * for it. This is only here to stop a truly stuck request hanging forever,
 * which it previously did: no timeout at all meant a wedged call blocked draft
 * generation indefinitely with nothing in the log after "[Writer] Generating…".
 */
const MODEL_TIMEOUT_MS = 240_000;

async function openrouter(body, apiKey, label, timeoutMs = MODEL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(CONFIG.openrouter_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://sys.terrytory.com",
        "X-Title": `Terrytory ${label}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s (model: ${body.model})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${label} API error: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

export function parseModelJson(raw) {
  // A refusal or a truncated stream gives us no content at all. Say that,
  // rather than dying on `null.trim()` and reporting it as a parse failure.
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Model returned no content.");
  }
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
export async function writeArticleDraft(ctx, pick, researchReport, styleGuide, apiKey, modelOverride, format, author, socialEmbeds = []) {
  const model = modelOverride || CONFIG.model;
  ctx.log("info", `  [Writer] Generating ${format || "article"} draft via ${model}${author ? ` as ${author.name}` : ""}...`);

  const sourceContext = pick.source_articles
    .map((s, i) => `[Source ${i + 1}] Title: "${s.title}" (URL: ${s.url})\nExcerpt: ${s.excerpt || "N/A"}`)
    .join("\n\n");

  // Real social posts pulled from the source articles. The writer may weave the
  // relevant ones in as [EMBED #En: url] tokens (like the image-slot tokens).
  const embedContext = socialEmbeds.length
    ? `\n──────────────────────────────
AVAILABLE SOCIAL POSTS (real, pulled from the sources — embed the ones that genuinely strengthen the piece):
──────────────────────────────
${socialEmbeds.map((e) => `[${e.id}] ${e.platform.toUpperCase()}${e.handle ? ` ${e.handle}` : ""}${e.text ? `: "${e.text}"` : ""} — ${e.url}`).join("\n")}

To embed one, place a token on its OWN LINE in body_markdown at the exact spot it belongs, in this form: [EMBED #E1: <url>] (use the matching id and its url). Only embed a post when it is a primary source, a key quote, or a demo that adds real value — skip the rest. Never invent posts or URLs.\n`
    : "";

  const brand = ctx.niche.brand?.name || "TERRYTORY";
  const angleNote = pick.angle ? `\n\nEDITORIAL ANGLE (the specific take to write toward):\n${pick.angle}\n` : "";
  const prompt = `${getEditorialPrompt(ctx.niche, { format, author })}${angleNote}

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
${embedContext}
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
      // 1536x864 rather than the landscape_16_9 preset (1024x576), which was
      // soft on retina in a full-width hero. Flux dev is trained around 1MP, so
      // this 1.3MP stretch stays close enough to avoid the duplicated-element
      // artifacts that show up nearer 2MP.
      body: JSON.stringify({ prompt: fullPrompt, image_size: { width: 1536, height: 864 } }),
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
  const author = authorForFormat(ctx.niche.id, format);
  const researchReport = await performResearch(ctx, spec.headline, spec.source_articles, apiKey);
  ctx.log("info", `  Research complete (${researchReport.length} chars)`);

  // Capture social posts embedded in the source articles (X, YouTube, …) so the
  // writer can weave the relevant ones in and the editor can curate them.
  let social_embeds = [];
  try {
    social_embeds = await collectSocialEmbeds(spec.source_articles || [], ctx.log);
    social_embeds = social_embeds.map((e, i) => ({ ...e, id: `E${i + 1}` }));
  } catch (e) {
    ctx.log("warn", `  social embed capture failed: ${e.message}`);
  }

  const styleGuide = getFewShotExamples(ctx);
  const draftContent = await writeArticleDraft(ctx, spec, researchReport, styleGuide, apiKey, modelOverride, format, author, social_embeds);
  // AI now commits to a single best headline; keep backward-compat with older `headline_options`.
  const finalHeadline =
    draftContent.headline || draftContent.headline_options?.[0] || spec.headline;
  ctx.log("info", `  ✓ ${format} generated: "${finalHeadline}"`);

  const draftId = spec.id;

  // Image generation disabled — images are editor-sourced via visual_suggestions.
  // The editor uploads real images through the Review UI's "Insert image" button.

  const draftData = {
    id: draftId,
    niche: ctx.niche.id,
    created_at: new Date().toISOString(),
    status: "draft",
    format,
    author: authorByline(author),
    source_articles: spec.source_articles,
    headline: finalHeadline,
    headline_options: [finalHeadline],
    selected_headline: finalHeadline,
    slug: draftContent.slug || spec.id,
    body_markdown: draftContent.body_markdown || "",
    excerpt: draftContent.excerpt || "",
    seo: draftContent.seo || { meta_title: "", meta_description: "", keywords: [] },
    hero_image_prompt: draftContent.hero_image_prompt || null,
    visual_suggestions: draftContent.visual_suggestions || [],
    social_embeds,
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
