/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CONTENT PIPELINE CONFIGURATION v2 — niche-aware             ║
 * ║  Models + limits are global; voice, criteria, image style,   ║
 * ║  and monetization come from system/niches/<id>.json.         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getFormat, DEFAULT_FORMAT } from "./content-formats.mjs";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

// Resolve which model tier (low/medium/best) the AI agents should use.
// Tier is chosen in the dashboard (Analytics → AI spending preset) and
// persisted to runtime-settings.json; the model map lives in model-tiers.json.
function resolveModelTier() {
  const defaults = {
    writer: "anthropic/claude-sonnet-4.6",
    rating: "google/gemini-2.5-flash",
    research: "perplexity/sonar",
    image: "openai/dall-e-3",
  };
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "runtime-settings.json"), "utf-8"));
    const tiers = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "model-tiers.json"), "utf-8"));
    const tier = tiers[settings.spend_tier] || tiers.medium;
    return { tier: settings.spend_tier || "medium", ...defaults, ...tier };
  } catch {
    return { tier: "medium", ...defaults };
  }
}

const TIER = resolveModelTier();

export const CONFIG = {
  // ── AI Models (resolved from the active spend tier) ─────────────
  spend_tier: TIER.tier,
  model: TIER.writer, // Main writer model
  fallback_model: "openai/gpt-4o",
  rating_model: TIER.rating, // Fast, cheap model for analyzing/rating
  perplexity_model: TIER.research, // Online web search model via OpenRouter

  // ── Generation Limits ───────────────────────────────────────────
  max_drafts_per_run: 3,
  drafts_per_cycle: 2,
  target_word_count: 1200,
  max_source_text_chars: 8000,
  rating_threshold: 8.0,

  // ── Image Generation ────────────────────────────────────────────
  image_generation: true,
  image_model: TIER.image,

  // ── API ─────────────────────────────────────────────────────────
  openrouter_url: "https://openrouter.ai/api/v1/chat/completions",
};

/**
 * Master editorial prompt, assembled from the niche config.
 *
 * @param opts  Either a number (legacy wordCount) or { wordCount, format }.
 *              `format` selects a content shape from content-formats.mjs
 *              (article/tip/comparison/…); defaults to "article".
 */
export function getEditorialPrompt(niche, opts = {}) {
  const o = typeof opts === "number" ? { wordCount: opts } : opts || {};
  const format = getFormat(o.format || DEFAULT_FORMAT);
  const target = o.wordCount || format.word_count || niche.editorial?.target_word_count || CONFIG.target_word_count;
  const imageCount = Math.max(0, format.image_count ?? 2);
  const brand = niche.brand?.name || "TERRYTORY";
  const description = niche.editorial?.publication_description || "a premium publication";
  const imageStyle = niche.editorial?.image_style || "Prefer atmospheric, cinematic, editorial imagery relevant to the story";
  const affiliate = niche.monetization?.mode === "affiliate";

  const faqSection = format.faq
    ? `
FAQ SECTION (required for this format):
- End the body with a "## Frequently Asked Questions" heading.
- Provide 3-4 real questions a reader would actually search for, each as a "### " subheading phrased as the question.
- Answer each in 2-4 tight, authoritative sentences. Answers must add new specifics, not repeat the body verbatim.
`
    : "";

  const affiliateSection = affiliate
    ? `
MONETIZATION SLOTS (affiliate):
- Identify 1-3 natural moments in the article where a reader would genuinely benefit from a booking/product recommendation (a hotel, flight route, tour, gear item).
- For each, add an entry to "affiliate_slots": { "after_paragraph": <1-indexed>, "kind": "hotel|flight|tour|gear|other", "query": "<what to search/link>", "context": "<one sentence on why this helps the reader here>" }.
- Slots must serve the reader first — never force one where it doesn't fit. Zero slots is acceptable.
- Do NOT invent URLs or prices in the article body. The slots are filled in later by the monetization system.
`
    : "";

  const affiliateJson = affiliate
    ? `,
  "affiliate_slots": [
    { "after_paragraph": 4, "kind": "hotel", "query": "boutique hotels Lisbon Alfama", "context": "Reader just learned Alfama is the best base for first-timers." }
  ]`
    : "";

  const persona = o.author
    ? `You are ${o.author.name}, ${o.author.title} at ${brand}, ${description}.
YOUR VOICE: ${o.author.voice}
Write every sentence as ${o.author.name} would — this is your byline. Never mention that you are an AI.`
    : `You are an elite editorial journalist for ${brand}, ${description}.`;

  return `${persona}

You are writing a ${format.label.toUpperCase()} (${format.id}).

WRITING GUIDELINES & PACING:
- Write ORIGINAL ${format.label.toLowerCase()} content — synthesize the source material into fresh, insightful journalism
- NEVER copy/paste sentences from sources. Rewrite everything in your own voice
- Strict prohibition of excessive em-dashes (—) and hyphens (-) for pauses/parentheticals. Punctuation should default to standard commas, parentheses, or shorter separate sentences to eliminate "AI-sounding" prose. Sentences must flow naturally without typical robotic LLM pauses.
- Lead with the most compelling angle — hook the reader in the first paragraph
- Use active voice, short paragraphs (2-3 sentences each), and compelling subheadings
- Include context: why does this matter? What are the implications?
- DEPTH & AUTHORITY: ground claims in specifics from the research — name the labs, people, models, benchmarks, dates, and numbers. Prefer one concrete fact over three vague statements. Write like an expert who has actually followed this story, not a summarizer.
- ENTITY LINKS: the first time you name a well-known company, product, lab, or organization (e.g. SpaceX, OpenAI, NVIDIA, Anthropic, Hugging Face), turn that mention into a Markdown link to its official homepage: [SpaceX](https://www.spacex.com). Only link entities whose official URL you are confident about — if unsure, leave it as plain text rather than guessing. Link each entity at most once (the first mention), don't link generic terms, and never invent URLs or link to article/news pages.
- Target approximately ${target} words
- Structure for this ${format.label.toLowerCase()}: ${format.structure}
${faqSection}

SEO REQUIREMENTS:
- Write the single best headline for this article — the one strongest, most compelling title that accurately fits the story you wrote. Do not offer alternatives; commit to the best one.
- Write a meta_title under 60 characters
- Write a meta_description under 155 characters that compels clicks
- Include 5-8 focus keywords naturally woven throughout the text
- Use H2 (##) subheadings every 150-200 words — make them informative, not generic
- First paragraph MUST contain the primary keyword
- Use bold (**text**) for key terms and findings
${affiliateSection}
IMAGE BRIEFS (editor-sourced, NOT AI-generated):
- Do NOT generate images. Instead, suggest ${imageCount + 1}-${imageCount + 2} specific images that a human editor should find, download, create, or photograph.
- For each image, provide a detailed aesthetic description so the editor knows EXACTLY what to look for. Think like a photo editor briefing a photographer.
  - Good: "Close-up of a PlayStation 5 Pro console in white, sitting on a clean wooden desk, warm interior lighting, shallow depth of field, editorial aesthetic"
  - Good: "Split-screen comparison: ChatGPT interface on the left vs Claude interface on the right, both showing code generation, dark mode, clean screenshot"
  - Bad: "An image of AI" (too vague)
- Describe the SUBJECT — what is in frame, the angle, the moment. Do NOT prepend house style ("premium editorial", "magazine quality", "cinematic", "4k") or list negatives ("no text"): the publication's visual identity and those constraints are applied automatically per image kind. Style adjectives in the brief only dilute the subject.
- Set "kind" accurately — it selects the art direction. A UI gets "screenshot", a real scene or moment gets "photo", an abstract concept gets "diagram".
- PREFER "photo" and "screenshot". Generated images cannot contain readable text, so a "diagram" can never label its own steps — only use "diagram" for a genuinely simple visual metaphor, never for a process/flow/architecture that depends on labels to make sense. If a piece needs a labelled diagram, say so in the description and the editor will make it by hand.
- These briefs are used verbatim as AI image-generation prompts, so they must be self-contained and literally depictable. Avoid abstractions no camera or illustrator could render ("the future of work", "innovation").
- Include the hero image as the first suggestion.
- Number the images IMG1, IMG2, IMG3… in the order they appear in the piece.
- For each, add an entry to "visual_suggestions" with: { "id": "IMG1", "kind": "hero|photo|screenshot|comparison|diagram|logo", "description": "<detailed visual brief — be specific about subject, angle, lighting, mood>", "placement": "<where in the piece it belongs, e.g. 'hero image' or 'after the comparison table'>" }.
- CRITICAL — inline placement tokens: for every NON-hero image, drop a placeholder token on its own line in "body_markdown" at the EXACT spot it belongs, in this exact form: [IMAGE #IMG2: short description]. Use the same id as the matching visual_suggestions entry. Do NOT place a token for the hero image (it sits at the top automatically). This lets the editor drop the real asset straight into the right slot.
- Suggest only visuals that genuinely strengthen the piece. The editor will find/create these and upload them.

You MUST respond with valid JSON only — no explanation text outside the JSON.

OUTPUT FORMAT:
{
  "headline": "The single best headline for this article",
  "slug": "url-safe-slug-here",
  "body_markdown": "Full article in Markdown with ## subheadings...",
  "excerpt": "Compelling 150-character excerpt for article cards...",
  "seo": {
    "meta_title": "Under 60 chars",
    "meta_description": "Under 155 chars that compels clicks",
    "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
  },
  "visual_suggestions": [
    { "id": "IMG1", "kind": "hero", "description": "Detailed visual brief for the hero image...", "placement": "hero image" },
    { "id": "IMG2", "kind": "screenshot", "description": "The product's demo UI from the launch post", "placement": "after the 'What it does' section" }
  ]${affiliateJson}
}`;
}

/** Topic-rating prompt for the fast rater model. */
export function getRatingPrompt(niche, sourcesDescription) {
  const brand = niche.brand?.name || "TERRYTORY";
  const description = niche.editorial?.publication_description || "a premium publication";
  const criteria = (niche.editorial?.rating_criteria || []).map((c) => `- ${c}`).join("\n");

  return `You are the lead content selector for ${brand}, ${description}.
Your job is to analyze the following scraped source material and decide if the topic warrants a published article.

CRITERIA FOR RATING:
${criteria}

SOURCE ARTICLES:
${sourcesDescription}

Analyze this topic and output a JSON object containing:
1. "headline": A clean, concise editorial headline summarizing the core topic.
2. "rating": A final rating score from 1.0 to 10.0 (float) based on the combined criteria above.
3. "reasoning": A detailed 2-3 sentence paragraph explaining your rating decision.
4. "summary": A brief 1-2 sentence summary of what occurred.

You MUST respond with valid JSON ONLY. Do not write markdown blocks or commentary outside the JSON.

JSON Output Format:
{
  "headline": "Topic Headline Here",
  "rating": 8.5,
  "reasoning": "Explain why this topic is rated this way based on the criteria.",
  "summary": "Short factual summary of the news."
}`;
}

/** Web-research prompt for the online search model. */
export function getResearchPrompt(niche, headline, sourcesText) {
  const focus = niche.editorial?.research_focus || "news topic";
  return `Perform a comprehensive, fact-checked web research report on the following ${focus}: "${headline}"
We want to write a deeply informative article based on this.

Here is the source context we have so far:
${sourcesText}

Your research report must address:
1. What are the latest developments/updates in the last 24-48 hours regarding this topic?
2. Who are the key figures, organizations, or places involved?
3. What is the timeline of events, and what concrete facts, numbers, or prices matter?
4. Are there any official statements, announcements, or policy changes?
5. Provide citations, quotes, and web link references where applicable.

Provide a detailed, structured research report with facts only.`;
}
