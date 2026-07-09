/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CONTENT FORMATS — the shapes the Creative Director can make  ║
 * ║  Content is NOT just articles. Each format has a planner hint ║
 * ║  (so the CD knows when to reach for it) and a writer guide    ║
 * ║  (structure + length + image count) injected into generation.║
 * ╚══════════════════════════════════════════════════════════════╝
 */

export const FORMATS = {
  article: {
    id: "article",
    label: "Article",
    emoji: "📰",
    planner_hint:
      "A full news article or analysis of a single significant development. Use for the day's biggest, most newsworthy story that deserves depth.",
    word_count: 1100,
    image_count: 2,
    structure:
      "Hook intro (1 para) → Context (1-2 para) → Core story (3-4 para) → Analysis (2-3 para) → Implications (1-2 para) → Forward-looking conclusion. Use ## subheads every 150-200 words.",
  },
  tip: {
    id: "tip",
    label: "Tip",
    emoji: "💡",
    planner_hint:
      "A short, practical, actionable tip a reader can use today (a workflow, a prompt technique, a tool trick). Use when a story implies something the reader can DO.",
    word_count: 500,
    image_count: 1,
    structure:
      "One-line promise → why it matters now (1 para) → the concrete steps or technique (numbered or bolded) → a short 'why this works' → one-line takeaway. Punchy and skimmable.",
  },
  comparison: {
    id: "comparison",
    label: "Comparison",
    emoji: "⚖️",
    planner_hint:
      "A head-to-head of two (or more) tools, models, or approaches. Use when the day's stories involve competing options readers must choose between.",
    word_count: 850,
    image_count: 1,
    structure:
      "Intro framing the choice → a Markdown comparison table of the contenders across 4-6 dimensions → a short section per contender (strengths/weaknesses) → a clear 'who should pick which' verdict.",
  },
  explainer: {
    id: "explainer",
    label: "Explainer",
    emoji: "🧭",
    planner_hint:
      "A 'what is / how does it work' piece that decodes a concept, technique, or term that's suddenly relevant. Use when a story assumes knowledge readers may lack.",
    word_count: 950,
    image_count: 2,
    structure:
      "Plain-language definition up top → why it's in the news → how it actually works (2-3 ## sections, analogies welcome) → where it matters / who's using it → what to watch next.",
  },
  roundup: {
    id: "roundup",
    label: "Roundup",
    emoji: "🗞️",
    planner_hint:
      "A brief digest of several notable developments at once. Use when there are multiple smaller stories that are individually thin but collectively worth a reader's time.",
    word_count: 800,
    image_count: 1,
    structure:
      "Short intro framing the theme of the day/week → 4-7 items, each a bolded lead line + 2-3 sentences of what happened and why it matters → a one-line 'bottom line' close.",
  },
  listicle: {
    id: "listicle",
    label: "List",
    emoji: "🔢",
    planner_hint:
      "A structured list (N tools, N shifts, N things to know). Use when a story naturally enumerates — releases, capabilities, use-cases.",
    word_count: 800,
    image_count: 1,
    structure:
      "Intro that promises the payoff → a numbered list (## per item) where each item has a claim + 2-3 sentences of substance → a synthesis close that ties them together.",
  },
};

export const FORMAT_IDS = Object.keys(FORMATS);
export const DEFAULT_FORMAT = "article";

export function getFormat(id) {
  return FORMATS[id] || FORMATS[DEFAULT_FORMAT];
}

/** A compact menu of formats for the Creative Director planner prompt. */
export function formatsMenu() {
  return FORMAT_IDS.map((id) => {
    const f = FORMATS[id];
    return `- "${f.id}" (${f.label}): ${f.planner_hint}`;
  }).join("\n");
}
