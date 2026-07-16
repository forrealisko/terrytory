/**
 * Content format identity for the UI — mirrors system/content/content-formats.mjs.
 *
 * We publish formats, not just "articles": a Hot Take and a Comparison are
 * different things and should look different everywhere they appear (Studio
 * slate, Create queue, review). Shared so those surfaces can't drift apart.
 */
export interface FormatMeta {
  emoji: string;
  label: string;
  /** Accent for the badge — keeps each format recognisable at a glance. */
  color: string;
}

export const FORMAT_META: Record<string, FormatMeta> = {
  article: { emoji: "📰", label: "Article", color: "#4f8dfd" },
  tip: { emoji: "💡", label: "Tip", color: "#f59e0b" },
  comparison: { emoji: "⚖️", label: "Comparison", color: "#38bdf8" },
  explainer: { emoji: "🧭", label: "Explainer", color: "#2dd4bf" },
  roundup: { emoji: "🗞️", label: "Roundup", color: "#a78bfa" },
  listicle: { emoji: "🔢", label: "List", color: "#f472b6" },
  opinion: { emoji: "🔥", label: "Hot Take", color: "#fb7185" },
};

/** Unknown/missing format degrades to a neutral mark rather than breaking. */
export function fmt(id?: string): FormatMeta {
  return FORMAT_META[id || ""] || { emoji: "✦", label: id || "Draft", color: "#9fb0d0" };
}
