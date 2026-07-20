# Pick up here

Session hit usage limit mid-build. Nothing is broken — one new file exists but
isn't wired in yet. Everything else in the repo is committed and working.

## State right now

- `website/src/components/Analytics.tsx` — **created, NOT wired in.** Does
  nothing until imported into the public layout. Safe to leave as-is.
- Everything else: committed, pushed, tests green (17/17).
- Vacation mode is **ON** (`system/content/runtime-settings.json`) — no
  automation running, no spend.
- `TODAY_PLAN.md` and `Terrytory_Strategic_Review.pdf` are in the repo root.

## The decision that drives everything below

Lukáš wants to run this **manually, 1–2 articles/day**, alternating niches by
mood. Morning one, maybe an evening one in the other niche. **No autopilot** —
he pulls the trigger himself. The autopilot script
(`system/content/run-automated-cycle.mjs`) exists but is deliberately unwired.
Leave it that way.

The point of the manual approach is that every decision he makes is training
data. That's the whole strategy — see item 4.

---

## 1. Analytics — finish wiring (CRITICAL, ~20 min)

`Analytics.tsx` is written and provider-agnostic (Plausible / Umami / GA4 via
env var, renders nothing if none set). To finish:

- Import and render it in the **public** layout only — likely
  `website/src/app/site/[niche]/layout.tsx` and `website/src/app/page.tsx`
  (the hub). **Not** in the admin layout; his own clicks are not traffic.
- Recommend **Umami** to him: free at this traffic, no EU cookie banner, and
  it self-hosts for nothing once he moves to the VPS.
- Also add Google Search Console verification (a `<meta>` tag or DNS record) —
  free, and it's the only way to see search impressions.
- Verify with `read_network_requests` that the script actually loads on a
  public page and does NOT load on /admin.

Why it's critical: his stated goal is "I just want to see some traffic" and
right now the site has zero measurement of any kind.

## 2. Sources → collapsible, moved to bottom (~15 min)

In `website/src/app/site/[niche]/[slug]/page.tsx` around line 113, the Sources
block currently renders expanded, above "More from...".

- Wrap in a native `<details>` (no JS needed, works without hydration)
- Closed by default, summary reads something like "Sources (3)"
- **Move it below** the Related/"More from" section
- Style the `<summary>` in `website/src/styles/magazine.css` — remove the
  default triangle marker, add a chevron, match `.mag-endmatter` type

## 3. Publication goal progress in the UI (~30 min)

Milestones: **20 → 50 → 100** published articles. He wants to see it.

- Count from `listPublished()` across all enabled niches
- Put it somewhere he sees daily — sidebar under the niche switcher, or a
  banner on `/admin/content/published`
- Progress bar to the *next* milestone, e.g. "14 / 20 · 6 to go"
- Celebrate crossing one. He is doing this manually and needs the dopamine.

Current real counts: **2 AI, 0 tech, 12 UFO** (UFO is private/disabled, so it
arguably shouldn't count toward a public goal — ask him, or count only
enabled niches).

## 4. Editorial telemetry — the big one (~2h, highest value)

Extends the existing `system/content/editorial-memory.mjs`, which already
captures: headline rewrites, word-count delta, cut paragraphs, punctuation
tics (em dashes, semicolons, "not just X but Y"), image choice, rejections.

He explicitly asked for **more**, especially **time spent editing**. Add:

- **Time in editor** — timestamp on open, on save, on publish. Total editing
  duration per article. Long edit = the draft was bad; near-zero = it was good.
  This is arguably the single best quality signal available.
- **Edit sessions** — did he come back to it 3 times? Abandon and return?
- **Which fields he touches most** — headline vs body vs excerpt vs SEO.
  If he rewrites every headline, that's a prompt problem to fix directly.
- **Time of day / niche choice** — he picks niche "by mood"; over weeks that
  may correlate with something useful.
- **Image regeneration count** — already partly captured; make sure the number
  of regenerations before he accepts one is recorded.
- **Aggregate rollup** — a `stats.json` per niche with running averages, so
  the numbers are readable without parsing every record.
- **Surface it in the admin** — he wants to *see* this, not just have it fed
  back into prompts. A small "what the AI has learned about you" panel.

Where to hook the timing: the review editor at
`website/src/app/admin/content/review/[id]/page.tsx`. Record `opened_at` on
mount, send elapsed time on save/publish. Beware: he may leave a tab open for
hours — cap or use active-editing heuristics (keystroke activity), don't just
diff open-to-save wall clock.

## 5. Then: publish the first article

Once 1–3 are done, actually ship one. Tech niche has **81 scored picks and
zero published articles** — lowest-hanging fruit in the whole project.

---

## Do NOT do

- **VPS migration** — his call, separate session. He said skip it for now.
- **Autopilot / auto-publishing** — he wants manual control.
- **Turning vacation mode off** — only after cost tracking is visible and he
  says go.
