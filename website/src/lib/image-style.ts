/**
 * TERRYTORY house visual style for AI-generated article images.
 *
 * One prompt wrapper for every image was the bug: a *diagram* or *comparison*
 * was being art-directed as "dramatic cinematic news photography", which fights
 * the brief. The style is therefore split into
 *   house identity (constant — this is the brand)
 * + a per-kind art direction line
 * + shared negatives.
 *
 * Kept deliberately tight. Flux follows descriptive prompts well, but padding a
 * prompt with adjectives dilutes the actual subject — the brief is the star, the
 * wrapper only sets house style.
 *
 * The palette mirrors the magazine (magazine.css): warm paper, deep ink, one
 * warm accent — so images sit in the page instead of fighting it.
 */

export type VisualKind = "hero" | "photo" | "screenshot" | "comparison" | "diagram" | "logo";

/** The brand. Constant across every image so the magazine looks like one thing. */
const HOUSE =
  "Premium editorial magazine visual for a modern technology publication. " +
  "Sophisticated, restrained, confident. Warm paper-toned neutrals, deep ink blacks, " +
  "a single warm accent. Considered natural light. Generous negative space. " +
  "Never stocky, cheesy, or clip-art.";

/** AI-rendered text is almost always garbled — ban it everywhere. */
const NEGATIVE =
  "No text, words, letters, captions, watermarks or real brand logos. " +
  "No distorted hands or faces.";

const BY_KIND: Record<VisualKind, string> = {
  hero:
    "Wide cinematic establishing shot with one strong focal subject, shallow depth of field, " +
    "dramatic but believable light.",
  photo:
    "Documentary editorial photograph. Real environment, natural light, candid and unposed.",
  screenshot:
    "Clean realistic interface or product mockup on a neutral surface. Crisp geometry, " +
    "plausible modern UI shapes rendered as blocks and lines rather than readable text.",
  comparison:
    "Balanced side-by-side composition split into two clearly distinct halves, " +
    "symmetrical framing, neutral background.",
  diagram:
    "Minimal flat vector illustration. Limited palette, geometric shapes, generous whitespace, " +
    "technical but elegant. Not photorealistic.",
  logo:
    "Simple abstract geometric mark, centred on a plain background. " +
    "Must not resemble any existing real-world brand.",
};

/**
 * Compose the final fal prompt: house style + kind art direction + the brief.
 * The brief goes last and is labelled, so the model treats it as the subject
 * rather than as more style adjectives.
 */
export function buildImagePrompt(brief: string, kind?: string): string {
  const k = (kind || "photo").toLowerCase();
  const direction = BY_KIND[k as VisualKind] ?? BY_KIND.photo;
  return `${HOUSE} ${direction} Subject: ${brief.trim()} ${NEGATIVE}`;
}
