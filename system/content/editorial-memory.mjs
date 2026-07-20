/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  EDITORIAL MEMORY — learn the editor's taste from their edits     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Every published article carries two versions: what the model wrote
 * (`ai_original`, frozen at generation) and what actually shipped. The gap
 * between them is the only honest description of this publication's voice —
 * better than any style guide, because it's what the editor *did* rather than
 * what they said they wanted.
 *
 * This module records that gap on publish (and records rejections, which are
 * the strongest signal of all), then feeds recent examples back into the writer
 * prompt so the next article starts closer to the target.
 *
 * Records live in system/content/niches/<niche>/learning/. They are plain JSON
 * and safe to read, diff, or delete; deleting them only costs the model its
 * memory of your preferences.
 *
 * Deliberately no LLM calls here. Distilling edits into "rules" via a model
 * costs money on every run and adds a layer that can hallucinate a preference
 * you never expressed. Showing the model real before/after pairs is cheaper and
 * harder to get wrong.
 */
import fs from "node:fs";
import path from "node:path";

/** Strip markdown noise so text comparisons are about words, not syntax. */
function words(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`[\]()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Punctuation and phrasing tics worth counting explicitly.
 *
 * These are the things that make AI prose read as AI prose, and the editor
 * strips them by hand every time. Counting them per article turns a vague
 * "sounds robotic" into a number that can be shown to the model.
 */
function tics(text) {
  const t = String(text || "");
  return {
    em_dashes: (t.match(/—/g) || []).length,
    semicolons: (t.match(/;/g) || []).length,
    // "not just X, but Y" and friends — the LLM's favourite rhetorical scaffold
    not_just: (t.match(/\bnot just\b/gi) || []).length,
    isnt_merely: (t.match(/\bisn't (just|merely|simply)\b/gi) || []).length,
    // "In today's fast-paced world" openers
    in_todays: (t.match(/\bin today's\b/gi) || []).length,
    rhetorical_q: (t.match(/\?\s*$/gm) || []).length,
  };
}

function ticDelta(before, after) {
  const a = tics(before);
  const b = tics(after);
  const delta = {};
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) delta[k] = { ai: a[k], final: b[k] };
  }
  return delta;
}

/** Paragraphs the editor removed outright, and ones they added. */
function paragraphChanges(before, after) {
  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const a = String(before || "").split(/\n{2,}/).map(norm).filter(Boolean);
  const b = new Set(String(after || "").split(/\n{2,}/).map(norm).filter(Boolean));
  const aSet = new Set(a);
  return {
    cut: a.filter((p) => !b.has(p)).slice(0, 5),
    added: [...b].filter((p) => !aSet.has(p)).slice(0, 5),
  };
}

/**
 * Record how an article changed between generation and publication.
 * No-op for drafts written before ai_original existed.
 */
export function recordPublishedEdit(article, paths) {
  const ai = article.ai_original;
  if (!ai) return null;

  const finalHeadline = article.selected_headline || article.headline || "";
  const finalBody = article.body_markdown || "";

  const aiWords = words(ai.body_markdown).length;
  const finalWords = words(finalBody).length;

  // Which image actually shipped, out of everything generated for each slot.
  // Picking the fourth regeneration says something the first three don't.
  const imageChoices = (article.visual_suggestions || [])
    .filter((v) => Array.isArray(v.images) && v.images.length)
    .map((v) => ({
      prompt: v.prompt || v.description || null,
      generated: v.images.length,
      chose_index: v.selected_index ?? v.images.length - 1,
      regenerated: v.images.length > 1,
    }));

  const record = {
    id: article.id,
    niche: article.niche,
    slug: article.published_slug || article.slug,
    format: article.format || "article",
    model: ai.model,
    recorded_at: new Date().toISOString(),
    verdict: "published",

    headline: {
      ai: ai.headline,
      final: finalHeadline,
      changed: ai.headline !== finalHeadline,
    },
    excerpt: {
      ai: ai.excerpt,
      final: article.excerpt || "",
      changed: (ai.excerpt || "") !== (article.excerpt || ""),
    },
    body: {
      ai_words: aiWords,
      final_words: finalWords,
      // Negative means the editor cut. Consistent cutting is a length signal.
      word_delta: finalWords - aiWords,
      untouched: ai.body_markdown === finalBody,
      ...paragraphChanges(ai.body_markdown, finalBody),
    },
    tics: ticDelta(ai.body_markdown, finalBody),
    images: imageChoices,
  };

  return write(record, paths);
}

/** A rejected draft — the editor's clearest "no". */
export function recordRejection(draft, paths, reason) {
  const ai = draft.ai_original;
  if (!ai) return null;
  return write(
    {
      id: draft.id,
      niche: draft.niche,
      slug: draft.slug,
      format: draft.format || "article",
      model: ai.model,
      recorded_at: new Date().toISOString(),
      verdict: "rejected",
      reason: reason || null,
      headline: { ai: ai.headline, final: null, changed: false },
      body: { ai_words: words(ai.body_markdown).length },
      tics: tics(ai.body_markdown),
    },
    paths
  );
}

function write(record, paths) {
  const dir = path.join(paths.content, "learning");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${record.recorded_at.slice(0, 10)}_${record.id}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    return file;
  } catch {
    // Read-only filesystem, or a permissions problem. Learning is a nice-to-have;
    // never let it take down a publish.
    return null;
  }
}

export function readRecords(paths, limit = 40) {
  const dir = path.join(paths.content, "learning");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-limit)
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Turn recent records into prompt text for the writer.
 *
 * Returns "" until there are at least three records — below that any "pattern"
 * is one article's quirk, and telling the model to imitate noise is worse than
 * telling it nothing.
 */
export function buildStyleBrief(paths, { maxHeadlines = 8, maxCuts = 4 } = {}) {
  const records = readRecords(paths);
  const published = records.filter((r) => r.verdict === "published");
  if (published.length < 3) return "";

  const lines = [];

  const rewritten = published.filter((r) => r.headline?.changed).slice(-maxHeadlines);
  if (rewritten.length) {
    lines.push("HEADLINES THE EDITOR REWROTE (yours → theirs):");
    for (const r of rewritten) {
      lines.push(`  ✗ ${r.headline.ai}`);
      lines.push(`  ✓ ${r.headline.final}`);
    }
    lines.push("");
  }

  // Only claim a length preference if it's consistent, not just once.
  const deltas = published.map((r) => r.body?.word_delta ?? 0).filter((d) => d !== 0);
  if (deltas.length >= 3) {
    const avg = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length);
    if (avg <= -40) {
      lines.push(`LENGTH: the editor cuts about ${Math.abs(avg)} words from your drafts. Write tighter.`);
      lines.push("");
    } else if (avg >= 40) {
      lines.push(`LENGTH: the editor adds about ${avg} words. Develop points further.`);
      lines.push("");
    }
  }

  // Tics they remove more often than they leave alone.
  const ticTotals = {};
  for (const r of published) {
    for (const [k, v] of Object.entries(r.tics || {})) {
      if (typeof v !== "object") continue;
      ticTotals[k] = (ticTotals[k] || 0) + (v.ai - v.final);
    }
  }
  const stripped = Object.entries(ticTotals)
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1]);
  if (stripped.length) {
    const names = {
      em_dashes: "em dashes (—)",
      semicolons: "semicolons",
      not_just: '"not just X, but Y" constructions',
      isnt_merely: '"isn\'t merely/simply" constructions',
      in_todays: '"in today\'s ..." openers',
      rhetorical_q: "rhetorical questions",
    };
    lines.push("THE EDITOR CONSISTENTLY DELETES THESE — do not use them:");
    for (const [k, n] of stripped) lines.push(`  - ${names[k] || k} (removed ${n} times)`);
    lines.push("");
  }

  const cuts = published.flatMap((r) => r.body?.cut || []).slice(-maxCuts);
  if (cuts.length) {
    lines.push("PARAGRAPHS THE EDITOR CUT ENTIRELY — avoid writing anything like these:");
    for (const c of cuts) lines.push(`  ✗ "${c.slice(0, 180)}${c.length > 180 ? "…" : ""}"`);
    lines.push("");
  }

  if (!lines.length) return "";

  return [
    "─── HOUSE STYLE, LEARNED FROM THIS EDITOR'S ACTUAL EDITS ───",
    `(from the last ${published.length} published articles — follow it over generic best practice)`,
    "",
    ...lines,
  ].join("\n");
}
