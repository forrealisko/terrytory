/**
 * Pure (no-fs) helpers for the review editor's inline image slots. Kept separate
 * from article-store so client components can import them without pulling in
 * node:fs. `VisualSuggestion` is a type-only import (erased at build).
 */
import type { VisualSuggestion } from "@/lib/article-store";

/**
 * Bake [IMAGE #IMGn: …] slot anchors into final sized Markdown for publishing.
 * Each token becomes ![caption](selected_url){size=…}, or is dropped if the slot
 * has no chosen image. Shared by the review editor (ship) and the publish preview.
 */
export function bakeImageSlots(body: string, slots: VisualSuggestion[] = []): string {
  return body.replace(/\[IMAGE #(IMG\d+):\s*([^\]]*)\]/g, (_m, id, desc) => {
    const slot = slots.find((s) => s.id === id);
    if (!slot?.selected_url) return "";
    const caption = (slot.description || desc || "").replace(/"/g, "");
    const size = slot.size && slot.size !== "full" ? `{size=${slot.size}}` : "";
    return `\n\n![${caption}](${slot.selected_url})${size}\n\n`;
  });
}
