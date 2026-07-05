# The Debrief — Headline Scraper

Robust, memory-aware headline scraper for [thedebrief.org](https://thedebrief.org/).

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
# Run scraper (opens Chromium window)
npm run scrape

# Run headless (no browser UI)
npm run scrape:headless

# Dry run (preview without saving)
npm test

# View scrape history & stats
npm run history              # stats overview
node history.mjs --all       # all headlines from latest scrape
node history.mjs --new       # only new (first-time-seen) headlines
```

## Output Structure

```
data/
├── memory.json          # Persistent memory — tracks all seen headlines
├── latest.json          # Always points to the most recent scrape
├── scraper.log          # Full log history
├── debug_snapshot.html  # Saved if scrape finds 0 headlines (debugging)
└── scrapes/
    ├── scrape_2026-06-18_22-31-00.json
    └── ...
```

## JSON Format

Each scrape file contains:

```json
{
  "meta": {
    "scrape_id": "uuid",
    "scraped_at": "ISO timestamp",
    "source_url": "https://thedebrief.org/",
    "total_headlines": 40,
    "new_headlines": 5,
    "previously_seen": 35,
    "featured_count": 3,
    "highlighted_count": 12,
    "article_count": 25
  },
  "headlines": [
    {
      "type": "featured|highlighted|article",
      "title": "Headline text",
      "url": "https://thedebrief.org/article-slug/",
      "article_date": "2026-06-18T08:28:47-04:00",
      "author": "Ryan Whalen",
      "excerpt": "A short description of the article...",
      "categories": ["breaking news", "physics"],
      "tags": ["exotic particle", "quasiparticles"],
      "date_analysis": {
        "relative": "today|yesterday|this_week|...",
        "age_days": 0,
        "parsed": "ISO date"
      },
      "is_new": true,
      "first_seen": "ISO timestamp"
    }
  ]
}
```

## Site-Specific Notes

- **Platform**: WordPress with 15zine theme by CodeTipi
- **Two layouts**:
  - **Featured grid** (`article.preview-grid`): Hero section, title + URL only — no dates, no excerpts
  - **Classic list** (`article.preview-classic`): Full metadata — ISO dates, author, excerpt
- **Categories & Tags**: Extracted from article CSS class names (e.g. `category-physics tag-quasiparticles`)
- **Highlighted articles**: `preview-2 stack` variant of classic — visually larger in layout
- **Lazy loading**: Aggressive scrolling to trigger content load

## Memory System

The scraper remembers every headline it has ever seen (by URL hash). On each run:
- **New** headlines are flagged `is_new: true`
- **Returning** headlines update their `last_seen` timestamp
- Stats track totals across all runs

## Proxy Support

Edit `CONFIG.proxy` in `scraper.mjs`:

```js
proxy: {
  server: "http://your-proxy:8080",
  username: "user",
  password: "pass",
}
```

## Anti-Detection

- Realistic User-Agent
- `navigator.webdriver` spoofed
- Blocks images/fonts/media (keeps CSS for lazy-load compat)
- Heavy scrolling for lazy-loaded content
- Retry with backoff on failures
