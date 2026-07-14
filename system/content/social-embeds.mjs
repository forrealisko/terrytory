/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Social embed capture — platform-agnostic                        ║
 * ║  Scans a source article's HTML for embedded social posts (X,     ║
 * ║  YouTube, Instagram, …) and returns a normalized list. Runs at   ║
 * ║  draft-generation time (only for sources that become articles,   ║
 * ║  so no wasted proxy bandwidth on every scraped headline).        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Dependency-free (regex + tag strip) so it can run anywhere in the
 * pipeline without pulling cheerio out of the engine's node_modules.
 *
 * Embed shape (stable — the website + writer rely on it):
 *   { platform, url, embed_id, author, handle, text, source, captured_at }
 */

const MAX_EMBEDS = 6;
const FETCH_TIMEOUT_MS = 12_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// Bare-link / iframe patterns per platform. `author` is optional.
const PROVIDERS = [
  {
    platform: "x",
    re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i,
    id: (m) => m[2],
    author: (m) => m[1],
    canonical: (m) => `https://x.com/${m[1]}/status/${m[2]}`,
  },
  {
    platform: "youtube",
    re: /https?:\/\/(?:www\.)?youtube\.com\/(?:watch\?v=|embed\/|shorts\/)([\w-]{6,})/i,
    id: (m) => m[1],
    canonical: (m) => `https://www.youtube.com/watch?v=${m[1]}`,
  },
  {
    platform: "youtube",
    re: /https?:\/\/youtu\.be\/([\w-]{6,})/i,
    id: (m) => m[1],
    canonical: (m) => `https://www.youtube.com/watch?v=${m[1]}`,
  },
  {
    platform: "instagram",
    re: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)/i,
    id: (m) => m[1],
    canonical: (m) => `https://www.instagram.com/p/${m[1]}/`,
  },
];

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse embeds out of a page's HTML. Pure — no network.
 * Prefers rich blockquotes (they carry the post text + author inline), then
 * falls back to bare links/iframes for every provider.
 */
export function extractEmbedsFromHtml(html) {
  if (!html) return [];
  const found = new Map(); // key `platform:id` → embed (first/richest wins)
  const now = new Date().toISOString();

  // 1. X/Twitter blockquotes: <blockquote class="twitter-tweet">…</blockquote>
  //    carry the tweet text + the author's status link.
  const bqRe = /<blockquote[^>]*class="[^"]*twitter-tweet[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/gi;
  let bm;
  while ((bm = bqRe.exec(html))) {
    const inner = bm[1];
    const link = inner.match(/https?:\/\/(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i);
    if (!link) continue;
    const id = link[2];
    found.set(`x:${id}`, {
      platform: "x",
      url: `https://x.com/${link[1]}/status/${id}`,
      embed_id: id,
      author: link[1],
      handle: `@${link[1]}`,
      text: stripTags(inner).replace(/—?\s*\w[\w ]*\(@\w+\).*$/, "").trim().slice(0, 400) || null,
      source: "blockquote",
      captured_at: now,
    });
  }

  // 2. Instagram blockquotes carry a caption too.
  const igRe = /<blockquote[^>]*class="[^"]*instagram-media[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/gi;
  let im;
  while ((im = igRe.exec(html))) {
    const inner = im[1];
    const link = inner.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)/i);
    if (!link) continue;
    found.set(`instagram:${link[1]}`, {
      platform: "instagram",
      url: `https://www.instagram.com/p/${link[1]}/`,
      embed_id: link[1],
      author: null,
      handle: null,
      text: stripTags(inner).slice(0, 300) || null,
      source: "blockquote",
      captured_at: now,
    });
  }

  // 3. Bare links + iframes for every provider.
  for (const p of PROVIDERS) {
    const re = new RegExp(p.re.source, "gi");
    let m;
    while ((m = re.exec(html))) {
      const id = p.id(m);
      const key = `${p.platform}:${id}`;
      if (found.has(key)) continue;
      const author = p.author ? p.author(m) : null;
      found.set(key, {
        platform: p.platform,
        url: p.canonical(m),
        embed_id: id,
        author,
        handle: author ? `@${author}` : null,
        text: null,
        source: "link",
        captured_at: now,
      });
    }
  }

  return [...found.values()].slice(0, MAX_EMBEDS);
}

/** Fetch a URL's HTML (best-effort, direct) and extract embeds. */
export async function extractEmbedsFromUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return extractEmbedsFromHtml(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collect deduped embeds across a pick's source articles (capped).
 * `log` is optional (ctx.log-style).
 */
export async function collectSocialEmbeds(sourceArticles = [], log) {
  const byKey = new Map();
  for (const src of sourceArticles) {
    if (!src?.url) continue;
    const embeds = await extractEmbedsFromUrl(src.url);
    for (const e of embeds) {
      const key = `${e.platform}:${e.embed_id}`;
      if (!byKey.has(key)) byKey.set(key, { ...e, from_source: src.url });
    }
    if (byKey.size >= MAX_EMBEDS) break;
  }
  const out = [...byKey.values()].slice(0, MAX_EMBEDS);
  if (log && out.length) log("info", `  ✓ Captured ${out.length} social embed(s)`);
  return out;
}
