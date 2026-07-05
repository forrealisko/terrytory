# The Black Vault — Headline Scraper

Robust, memory-aware headline scraper for [theblackvault.com](https://www.theblackvault.com/documentarchive/).

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
    ├── scrape_2026-06-19_08-00-00.json
    └── ...
```

## JSON Format

Each scrape file contains:

```json
{
  "meta": {
    "scrape_id": "uuid",
    "scraped_at": "ISO timestamp",
    "source_url": "https://...",
    "total_headlines": 25,
    "new_headlines": 3,
    "previously_seen": 22,
    "featured_count": 5,
    "primary_count": 10,
    "secondary_count": 5,
    "tertiary_count": 5
  },
  "headlines": [
    {
      "type": "featured|primary|secondary|tertiary|article",
      "title": "Headline text",
      "url": "https://...",
      "article_date": "2026-05-01T22:26:31+00:00",
      "date_analysis": {
        "relative": "this_month|this_week|today|yesterday|older|future",
        "age_days": 48,
        "parsed": "ISO date"
      },
      "is_new": true,
      "first_seen": "ISO timestamp"
    }
  ]
}
```

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
- Blocks images/fonts/CSS (speed + stealth)
- Randomized viewport
- Retry with backoff on failures
