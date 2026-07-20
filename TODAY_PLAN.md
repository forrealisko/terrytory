# Today's plan (for Opus)

Context: Terrytory autonomous content pipeline. Vacation mode is currently ON
(no automation running, no spend). User wants: cost visibility, resume
automation, clean up loose ends. **VPS migration is explicitly OUT OF SCOPE
today** — that's its own session later.

---

## 1. Cost tracking

OpenRouter responses already include `usage.prompt_tokens` /
`usage.completion_tokens` (see `system/content/pipeline-core.mjs` ~line 220,
the `generation` object). We capture tokens but never convert to $ or persist
it anywhere aggregate — right now the only way to know spend is the invoice.

Build:
- A small cost table (per-model $/1M tokens — OpenRouter exposes this via
  their `/models` endpoint, or hardcode the ones we actually use:
  deepseek/deepseek-chat, anthropic/claude-sonnet-4.6, claude-sonnet-4,
  gemini-2.5-flash/pro, perplexity/sonar/sonar-pro, dall-e-3, gpt-image-1)
- Compute `estimated_cost_usd` per generation call, store it on the draft's
  `generation` object (writer) and wherever rating/research calls log
  (rate-scrapes.mjs, pipeline-core research step)
- A simple daily rollup — could be as simple as an admin Analytics page card:
  "today's spend so far", "this week", "avg cost per article" — pull from
  existing draft/published JSON files rather than a new DB
- Whatever you build, make it read-only-safe on Vercel (reads are fine,
  don't add new writes that need GITHUB_TOKEN if avoidable)

Goal: user should be able to look at the dashboard and know roughly what a
day/week/cycle costs, without waiting for the OpenRouter invoice.

## 2. Turn vacation mode off

`system/content/runtime-settings.json` currently has `"vacation": true`.
Flip to `false` **only after** cost tracking is in and the user has seen a
number they're comfortable with — don't just flip it as step 2 blindly, loop
back to user first with "here's what a cycle costs, still want it on?"

If they say go: set `vacation: false`, commit, push. Confirm the next
scheduled run (06:00 UTC daily scrape) will pick it up.

## 3. Finishing touches / cleanup

Things flagged but not yet done, in priority order:

- **Dirty working tree**: `git status` currently shows uncommitted
  modifications to dozens of pick/idea files plus untracked test drafts,
  rejected/ folder, and generated images from prior testing sessions. Sort
  out what's real content vs test artifacts before doing anything else —
  check with user if unsure, don't just `git clean` blindly.
- **GITHUB_TOKEN in Vercel**: still not set. Until it is, admin write
  actions on the live site (feature/archive/edit, vacation toggle, settings)
  return 501. This is a manual step only the user can do (creating a
  fine-grained PAT) — remind them, can't do it for them.
- **Rating pass-rate anomaly**: flagged last week — tech niche passed 72/95
  topics against an 8.0/10 threshold in one run, which is a much higher pass
  rate than spot checks suggested was normal. Worth a quick look now that
  editorial-memory + cost tracking exist, in case the rater is too generous
  and it's inflating both article count and spend.
- **Full test suite pass** before calling anything "done" — 17 smoke tests
  exist in tests/smoke.test.mjs, run against both localhost and prod after
  any change.
- Anything else that surfaces while doing 1/2 — use judgment, but don't
  scope-creep into the VPS work.

---

## Explicitly NOT today

- VPS migration / Namecheap setup / DNS / deploy pipeline rework — separate
  session, user's call when to schedule it.
