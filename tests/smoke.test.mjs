/**
 * Smoke tests — the checks that would have caught what actually broke.
 *
 * These drive a running server over HTTP rather than importing internals,
 * because every real incident here lived in the wiring (a proxy gate that
 * skipped /api, images filed in a directory the route no longer read) and not
 * in any single function. A unit test of the pieces would have passed through
 * all of it.
 *
 *   node --test tests/                    # against localhost:3199
 *   TEST_BASE_URL=https://www.terrytory.xyz node --test tests/
 *
 * Assumes a server is already up (npm run dev, or a deploy).
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3199";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Fetch without following redirects — a 307 to /login is a pass, not a 200. */
async function raw(url) {
  return fetch(url, { redirect: "manual" });
}

function niches() {
  const dir = path.join(ROOT, "system", "niches");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

const enabled = () => niches().filter((n) => n.enabled !== false);
const disabled = () => niches().filter((n) => n.enabled === false);

function publishedArticles(nicheId) {
  const dir = path.join(ROOT, "system", "content", "niches", nicheId, "published");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

before(async () => {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`No server at ${BASE}. Start one (npm run dev) or set TEST_BASE_URL.`);
  }
});

// The drafts endpoint answered 200 to the whole internet for weeks. The UI
// redirected to /login while the API behind it just handed the data over, so
// nothing that only tested the UI would have noticed.
describe("admin API requires a session", () => {
  const guarded = [
    "/api/content/drafts",
    "/api/content/published",
    "/api/content/ideas",
    "/api/settings",
    "/api/scrapes",
    "/api/analytics",
  ];

  for (const ep of guarded) {
    test(`${ep} rejects an anonymous request`, async () => {
      const res = await raw(BASE + ep);
      assert.equal(res.status, 401, `${ep} should 401 without a session, got ${res.status}`);
    });
  }

  test("/admin redirects anonymous users to /login", async () => {
    const res = await raw(`${BASE}/admin`);
    assert.equal(res.status, 307);
    assert.match(res.headers.get("location") || "", /\/login$/);
  });
});

describe("public surfaces stay public", () => {
  for (const ep of ["/", "/login"]) {
    test(`${ep} is reachable`, async () => {
      assert.equal((await raw(BASE + ep)).status, 200);
    });
  }

  for (const n of enabled()) {
    test(`/site/${n.id} is reachable`, async () => {
      assert.equal((await raw(`${BASE}/site/${n.id}`)).status, 200);
    });
  }
});

// `enabled: false` used to mean "hidden from the hub" and nothing more, so a
// disabled niche served its articles to anyone holding the URL.
describe("disabled niches are private, not merely unlisted", () => {
  for (const n of disabled()) {
    test(`/site/${n.id} is not reachable`, async () => {
      assert.equal((await raw(`${BASE}/site/${n.id}`)).status, 404);
    });

    const [article] = publishedArticles(n.id);
    if (article?.slug) {
      test(`/site/${n.id}/${article.slug} is not reachable`, async () => {
        assert.equal((await raw(`${BASE}/site/${n.id}/${article.slug}`)).status, 404);
      });
    }
  }
});

// Five of fourteen articles shipped with broken images before anyone looked:
// some pointed at files stranded by a directory move, others at filenames the
// model invented and nothing ever generated.
describe("every published image resolves", () => {
  for (const n of enabled()) {
    for (const article of publishedArticles(n.id)) {
      const refs = [...(article.body_markdown || "").matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)]
        .map((m) => m[1])
        .filter((src) => !src.startsWith("http"));
      if (article.hero_image_url && !article.hero_image_url.startsWith("http")) {
        refs.push(article.hero_image_url);
      }
      if (!refs.length) continue;

      test(`[${n.id}] ${article.slug}`, async () => {
        for (const src of refs) {
          assert.ok(src.startsWith("/"), `relative ref can never resolve: ${src}`);
          const url = src.includes("?") ? `${BASE}${src}` : `${BASE}${src}?niche=${n.id}`;
          const res = await raw(url);
          assert.equal(res.status, 200, `${src} → ${res.status}`);
        }
      });
    }
  }
});
