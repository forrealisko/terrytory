# Terrytory

An autonomous, multi-niche content publishing engine. Scrapes sources, rates
stories with AI, writes long-form articles + images, and publishes them to
per-niche magazine sites (`ai.terrytory.xyz`, `tech.terrytory.xyz`, …).

## Layout

```
system/                 Backend pipeline (Node, no framework)
  niches/*.json         Per-niche config: brand, sources, voice, rating rules
  scraper/engine/       Generic HTML (Playwright) + RSS scraper
  content/              Rank → rate → research → write → images pipeline
  notify/telegram.mjs   Telegram notifier
  scrape-all.mjs        One-shot: scrape every niche + Telegram digest
website/                Next.js app
  src/app/(dashboard)/  Private admin (scraper, pipeline, editor, analytics)
  src/app/site/[niche]/ Public magazine (off-white editorial theme)
  src/proxy.ts          <niche>.terrytory.xyz → /site/<niche>
```

## Local dev

```bash
cd website && npm install && npm run dev      # admin at /, magazine at /site/ai
```

Secrets live in `system/.env` and `website/.env.local` (copy the `.example`
files). `system/lib/env.mjs` loads both; real `process.env` always wins, so CI
and Vercel just set env vars.

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import to Vercel, **Root Directory = `website`**.
3. Set env vars: `OPENROUTER_API_KEY`, `FAL_KEY` (+ proxy/telegram as needed).
4. Point a wildcard DNS record `*.terrytory.xyz` at Vercel; add the domains.

Content is read from `../system` at runtime — `next.config.ts` bundles it via
`outputFileTracingIncludes`, so the deployed functions ship the articles.

## Automation

`.github/workflows/scrape.yml` runs daily (GitHub Actions, free): scrapes all
niches, rates them, commits new headlines/picks, and sends a top-picks digest
to Telegram. Requires repo secrets mirroring the env vars above.

Generation stays human-in-the-loop: you pick a story, it's written, you review.
