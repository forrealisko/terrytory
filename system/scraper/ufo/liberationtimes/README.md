# Liberation Times — Headline Scraper

Robust, memory-aware headline scraper for [liberationtimes.com](https://www.liberationtimes.com/).

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
    "source_url": "https://www.liberationtimes.com/",
    "total_headlines": 20,
    "new_headlines": 3,
    "previously_seen": 17
  },
  "headlines": [
    {
      "type": "article",
      "title": "Headline text",
      "url": "https://www.liberationtimes.com/home/slug",
      "article_date": "2026-06-17T00:00:00.000Z",
      "article_date_raw": "6/17/26",
      "author": "Christopher Sharp",
      "excerpt": "First paragraph of the article...",
      "date_analysis": {
        "relative": "yesterday|today|this_week|this_month|...",
        "age_days": 1,
        "parsed": "ISO date"
      },
      "is_new": true,
      "first_seen": "ISO timestamp"
    }
  ]
}
```

## Site-Specific Notes

- **Platform**: Squarespace (blog-basic-grid layout)
- **Date format**: `M/D/YY` text (e.g. "6/17/26") — no `datetime` attribute
- **URLs**: Relative paths (`/home/slug`) — automatically resolved to absolute
- **Author**: Always present in `.blog-author` span (typically Christopher Sharp)
- **Excerpts**: Available in `.blog-excerpt-wrapper` for most articles

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
- Extended scrolling for Squarespace lazy-loading
- Retry with backoff on failures
