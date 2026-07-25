/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CREATIVE DIRECTOR — the newsroom's editor-in-chief agent     ║
 * ║                                                              ║
 * ║  Reads the day's rated stories and decides the best 2-5      ║
 * ║  content "scenarios" for today — each with a FORMAT (article, ║
 * ║  tip, comparison, …), a title, an angle, and why it's worth   ║
 * ║  running. You pick the best; the rest are banked for reuse.   ║
 * ║                                                              ║
 * ║  Usage:                                                      ║
 * ║    node creative-director.mjs plan   --niche ai [--count N]  ║
 * ║    node creative-director.mjs create --niche ai --id <id>    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CONFIG } from "./content-config.mjs";
import { FORMAT_IDS, DEFAULT_FORMAT, formatsMenu } from "./content-formats.mjs";
import {
  cliNiche,
  getNicheContext,
  getApiKey,
  parseModelJson,
  generateDraft,
} from "./pipeline-core.mjs";

// ─── args ────────────────────────────────────────────────────────────────────
function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const SUBCOMMAND = process.argv[2];

// ─── pick reading ────────────────────────────────────────────────────────────
function readPendingPicks(paths) {
  if (!fs.existsSync(paths.picks)) return [];
  return fs
    .readdirSync(paths.picks)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(paths.picks, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((p) => p && (p.status || "pending") === "pending")
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));
}

function readIdea(paths, id) {
  const file = path.join(paths.ideas, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeIdea(paths, idea) {
  fs.mkdirSync(paths.ideas, { recursive: true });
  fs.writeFileSync(path.join(paths.ideas, `${idea.id}.json`), JSON.stringify(idea, null, 2));
}

// The titles of ideas we've already proposed (any status), newest first. Fed to
// the planner so it doesn't re-pitch the same story day after day.
function readRecentIdeaTitles(paths, limit = 15) {
  if (!fs.existsSync(paths.ideas)) return [];
  const ideas = fs
    .readdirSync(paths.ideas)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(paths.ideas, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const seen = new Set();
  const titles = [];
  for (const idea of ideas) {
    const t = (idea.title || "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      titles.push(t);
    }
    if (titles.length >= limit) break;
  }
  return titles;
}

// Mark the picks a plan() run considered as "planned" so they don't resurface in
// the next run's pending pool. This is the core fix for duplicate slates: without
// it, the same top-rated pending picks get re-planned on every run.
function markPicksPlanned({ paths, log }, picks) {
  let n = 0;
  for (const pick of picks) {
    if (!pick?.id) continue;
    const file = path.join(paths.picks, `${pick.id}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      data.status = "planned";
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      n++;
    } catch {}
  }
  if (n) log("info", `[Creative Director] Marked ${n} pick(s) as planned (won't resurface next run).`);
}

// ─── planner prompt ──────────────────────────────────────────────────────────
function buildPlannerPrompt(niche, picks, count, recentTitles = []) {
  const brand = niche.brand?.name || "TERRYTORY";
  const description = niche.editorial?.publication_description || "a premium publication";

  const alreadyCovered = recentTitles.length
    ? `\nTOPICS ALREADY COVERED RECENTLY (do NOT re-pitch these — no near-duplicates, no rewordings, unless there is genuinely fresh news that changes the story):
${recentTitles.map((t) => `  - ${t}`).join("\n")}\n`
    : "";

  const stories = picks
    .map((p, i) => {
      const src = p.source_articles?.[0];
      return `[Story ${i + 1}] (rated ${p.rating ?? "?"}/10)
  Headline: ${p.headline}
  Summary: ${p.summary || p.reasoning || "—"}
  Source: ${src?.source_name || "?"} — ${src?.url || ""}`;
    })
    .join("\n\n");

  // These are cheap idea sketches, not drafts — nothing gets researched or
  // written until the editor clicks one. So propose a generous spread (8) and
  // let them choose; the cost of an unused idea is a few tokens, not an article.
  const countRule =
    count && count >= 1
      ? `Produce EXACTLY ${count} scenarios.`
      : `Produce 8 distinct scenarios, ordered best first. These are lightweight idea sketches the editor will browse — variety matters, so vary the format and the angle. Only the ones the editor picks get written, so it costs nothing to offer a wide spread.`;

  return `You are the Creative Director and Editor-in-Chief of ${brand}, ${description}.

Every day you look at what's happening in the niche and decide the best content to make. You do NOT just write articles — you choose the right FORMAT for each idea. Your job now: design today's content slate.

AVAILABLE FORMATS (choose the best fit per idea — diversify, don't make everything an article):
${formatsMenu()}

TODAY'S RATED STORIES (your raw material):
${stories}
${alreadyCovered}
WHAT MAKES AN IDEA WORTH RUNNING (optimize for engagement, not just importance):
- A clear "so what for me" hook — a money, productivity, career, or "build this today" angle beats a neutral recap.
- A real debate or tension — "is X overhyped?", "worth it or not?", "who actually wins?". Take a side when the story earns one (that's the Hot Take format).
- Timeliness — why this matters THIS week, not in general.
- A concrete payoff the reader walks away with (a decision, a mental model, a thing to try).

TONE & AUDIENCE:
- Sharp, fun, confident. Not boring, not clickbait. Willing to be a little controversial when the evidence backs it.
- Written for tech-savvy builders and operators, not 50-year-old academics.
- Every idea names its target audience (builders / businesses / researchers / tech-curious).

INSTRUCTIONS:
- ${countRule}
- Each scenario must be a genuinely compelling, distinct piece a reader would click. No overlap between scenarios.
- Pick the FORMAT that best serves each idea. Prefer variety across the slate, and use the Hot Take format when a story invites a strong position.
- Ground each scenario in one or more of the stories above (reference them by number).
- Give each a sharp, specific ANGLE — the exact take that makes it worth reading, not a generic summary.
- Rank them: scenario 1 is your strongest recommendation for today.

Respond with valid JSON ONLY (no markdown, no commentary):
{
  "scenarios": [
    {
      "format": "one of: ${FORMAT_IDS.join(", ")}",
      "title": "the working headline for this piece",
      "angle": "the specific editorial take / what makes it worth reading (1-2 sentences)",
      "audience": "who this is for (e.g. builders, businesses, researchers, tech-curious)",
      "rationale": "why this is a strong choice for TODAY — the engagement hook (1 sentence)",
      "source_indexes": [1]
    }
  ]
}`;
}

// ─── openrouter (planner uses the fast/cheap model) ─────────────────────────
async function callPlanner(prompt, apiKey) {
  const res = await fetch(CONFIG.openrouter_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://sys.terrytory.com",
      "X-Title": "Terrytory Creative Director",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CONFIG.rating_model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Planner API error: ${data.error?.message || JSON.stringify(data)}`);
  return { content: data.choices?.[0]?.message?.content || "", model: data.model || CONFIG.rating_model };
}

// Bank any leftover "proposed" ideas from earlier slates so a fresh daily run
// starts clean — yesterday's un-picked ideas move to the reuse bank rather than
// piling up in today's slate. (Created drafts are left untouched.)
// Ideas the editor never picked pile up forever otherwise — the bank had grown
// past 17 on one niche. Keep at most this many banked ideas for the "maybe
// later" pool (and as dedup memory for the planner); older ones are just noise.
const BANK_CAP = 12;

function bankStaleProposed({ paths, log }) {
  if (!fs.existsSync(paths.ideas)) return;

  // 1. Yesterday's unchosen slate moves to the bank.
  let banked = 0;
  for (const f of fs.readdirSync(paths.ideas).filter((x) => x.endsWith(".json"))) {
    const p = path.join(paths.ideas, f);
    try {
      const idea = JSON.parse(fs.readFileSync(p, "utf8"));
      if (idea.status === "proposed") {
        idea.status = "banked";
        fs.writeFileSync(p, JSON.stringify(idea, null, 2));
        banked++;
      }
    } catch {}
  }

  // 2. Prune the bank down to BANK_CAP, newest kept. Never delete an idea that
  //    became a draft (draft_id set) — that would orphan the draft's origin.
  const bankedIdeas = [];
  for (const f of fs.readdirSync(paths.ideas).filter((x) => x.endsWith(".json"))) {
    try {
      const idea = JSON.parse(fs.readFileSync(path.join(paths.ideas, f), "utf8"));
      if (idea.status === "banked" && !idea.draft_id) bankedIdeas.push({ f, idea });
    } catch {}
  }
  bankedIdeas.sort((a, b) => (b.idea.created_at || "").localeCompare(a.idea.created_at || ""));
  let pruned = 0;
  for (const { f } of bankedIdeas.slice(BANK_CAP)) {
    try {
      fs.unlinkSync(path.join(paths.ideas, f));
      pruned++;
    } catch {}
  }

  if (banked) log("info", `[Creative Director] Banked ${banked} unchosen idea(s) from the last slate.`);
  if (pruned) log("info", `[Creative Director] Pruned ${pruned} stale idea(s) from the bank (cap ${BANK_CAP}).`);
}

// ─── PLAN: propose today's slate ─────────────────────────────────────────────
async function plan(ctx) {
  const { paths, niche, log } = ctx;
  const apiKey = getApiKey();
  const countArg = parseInt(arg("--count") || "", 10);
  const count = Number.isFinite(countArg) ? Math.max(1, Math.min(8, countArg)) : null;

  // Clear the previous slate into the bank first so we don't accumulate stale unchosen ideas.
  bankStaleProposed(ctx);

  const picks = readPendingPicks(paths).slice(0, 15);
  if (!picks.length) {
    log("info", "No pending picks to plan from. Run the scraper first.");
    console.log("[creative-director] No pending picks — nothing to plan.");
    return;
  }

  const recentTitles = readRecentIdeaTitles(paths);
  log("info", `[Creative Director] Planning from ${picks.length} rated stories${count ? ` (target ${count})` : " (auto 2-5)"}${recentTitles.length ? `, avoiding ${recentTitles.length} recent topic(s)` : ""}...`);
  const { content, model } = await callPlanner(buildPlannerPrompt(niche, picks, count, recentTitles), apiKey);
  const parsed = parseModelJson(content);
  const scenarios = Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
  if (!scenarios.length) throw new Error("Planner returned no scenarios.");

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const saved = [];

  scenarios.slice(0, 8).forEach((s, rank) => {
    const format = FORMAT_IDS.includes(s.format) ? s.format : DEFAULT_FORMAT;
    const idxs = Array.isArray(s.source_indexes) ? s.source_indexes : [];
    const refPicks = idxs.map((n) => picks[n - 1]).filter(Boolean);
    const src = refPicks.length ? refPicks : [picks[0]];
    const source_articles = src.flatMap((p) => p.source_articles || []);

    const idea = {
      id: crypto.randomUUID(),
      niche: niche.id,
      batch_id: batchId,
      created_at: now,
      status: "proposed",
      format,
      title: s.title || "Untitled idea",
      angle: s.angle || "",
      audience: s.audience || "",
      rationale: s.rationale || "",
      priority: rank + 1,
      source_pick_ids: refPicks.map((p) => p.id),
      source_articles,
      draft_id: null,
      planner_model: model,
    };
    writeIdea(paths, idea);
    saved.push(idea);
    log("info", `  ${idea.priority}. [${format}] ${idea.title}`);
  });

  // Retire the picks we just planned from so they don't get re-planned next run.
  markPicksPlanned(ctx, picks);

  console.log(`\n[creative-director] Proposed ${saved.length} scenario(s) for ${niche.brand?.name || niche.id}:`);
  saved.forEach((i) => console.log(`  ${i.priority}. [${i.format}] ${i.title}`));
  console.log(`\n[batch ${batchId}]`);
}

// ─── CREATE: turn one idea into a full draft ────────────────────────────────
async function create(ctx) {
  const { paths, log } = ctx;
  const apiKey = getApiKey();
  const id = arg("--id");
  if (!id) throw new Error("create requires --id <ideaId>");

  const idea = readIdea(paths, id);
  if (!idea) throw new Error(`Idea not found: ${id}`);

  // Optional writer override, so a draft can be rewritten with a stronger model
  // than the active spend tier without changing the tier for everything else.
  const modelOverride = arg("--model") || null;

  log(
    "info",
    `[Creative Director] Creating ${idea.format}: "${idea.title}"${modelOverride ? ` (model: ${modelOverride})` : ""}`
  );

  const spec = {
    id: idea.id,
    headline: idea.title,
    angle: idea.angle,
    source_articles: idea.source_articles || [],
  };
  const draft = await generateDraft(ctx, spec, apiKey, { format: idea.format, modelOverride });

  idea.status = "created";
  idea.draft_id = draft.id;
  idea.created_draft_at = new Date().toISOString();
  writeIdea(paths, idea);

  log("info", `  ✓ Draft ready in CREATE queue (${draft.id})`);
  console.log(`[creative-director] Created draft ${draft.id} for idea ${idea.id}`);
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  const ctx = getNicheContext(cliNiche());
  if (SUBCOMMAND === "plan") return plan(ctx);
  if (SUBCOMMAND === "create") return create(ctx);
  console.error("Usage: creative-director.mjs <plan|create> --niche ai [--count N] [--id <ideaId>]");
  process.exit(1);
}

main().catch((err) => {
  console.error(`[creative-director] ${err.message}`);
  process.exit(1);
});
