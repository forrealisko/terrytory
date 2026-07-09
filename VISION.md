# Terrytory — Product Vision

_Last updated: 2026-07-07_

## North Star

An **autonomous AI content team**. Not a tool that writes an article when you
click a button — a system that behaves like a newsroom staffed entirely by AI:
a creative director, writers, and a photo desk. It decides *what* to make, makes
it, and (eventually) ships it — every article, every image, AI-produced.

Human touch stays optional. Early on we run it hands-off to see how good it can
get. Later, a human layer can be added back where it adds real value.

> The goal is to train and shape an agent so good the whole thing runs itself.

## The core shift: content is not just "articles"

Articles are **one** format. The system must produce whatever fits the niche and
the day: **tips, comparisons, short blogs, explainers, roundups, listicles**, and
formats we invent later. What to make is a *decision*, not a fixed template.

## The Creative Director (the heart of it)

Every day, per niche, an AI **Creative Director** agent:

1. **Reads the niche** — the day's scraped stories + what's happening in AI.
2. **Decides the slate** — proposes **2–5 content ideas ("scenarios")** for the
   day. The count is **AI-decided (2–5 max)** or user-selectable — never a fixed
   number, because more scenarios burn more tokens.
3. **Suggests + creates each idea** — every scenario is a fully-formed concept
   with a chosen *format* (article / tip / comparison / …), an angle, and a draft.
4. **You pick the best one.** The winner goes to publish.
5. **The rest are banked** — unused ideas are kept and can be pulled up and used
   on a later day. Nothing good is wasted.

The Dashboard surfaces this as a daily set of idea cards: _suggested → created →
you choose_. This replaces the old "here are rated topics, pick one to write"
flow with "here is a curated creative slate for today."

## Current scope (deliberately narrow)

- **One niche: `ai`.** Prove the loop end-to-end before expanding.
- Ditch all external notifiers (Telegram/Discord **removed**). Everything happens
  on the website. Picks/ideas surface in the Editorial Desk (`/admin/chat`).
- Scraping runs **daily and free** via GitHub Actions (Vercel is read-only and
  can't cron). It commits headlines + picks back to the repo; the deployed site
  reads them.

## Built so far

- Multi-niche scraper → rate → pick pipeline (GitHub Actions, daily).
- Per-niche magazine sites + public landing hub.
- **Editorial Desk** (`/admin/chat`): daily brief of picks, draft/angles inline,
  save → CREATE → review → publish.
- **Secure invite-only admin** (scrypt-hashed creds, signed sessions, no
  default/backdoor login, no public registration).

## Next up (the Creative Director build)

1. **Content-type model** — define formats (article, tip, comparison, …), each
   with its own structure + generator prompt.
2. **Daily planner agent** — reads the niche, decides 2–5 scenarios (count
   AI-decided or user-set), picks a format + angle for each.
3. **Idea bank** — store generated ideas; "pick the best," reuse the rest later.
4. **Dashboard section** — daily idea cards: suggested → created → chosen.
5. **Autonomous images** — hero + inline images per piece (AI photo desk).
6. Then: expand beyond `ai`, and consider an optional human-review layer.
