/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Publish scheduled articles that are due                         ║
 * ║  Run by .github/workflows/publish-scheduled.yml every 15 min so  ║
 * ║  scheduling works with no machine of ours running.               ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *   node system/content/publish-due.mjs [--dry-run]
 *
 * A draft is "due" when status === "scheduled" && publish_at <= now.
 *
 * Everything is finalized at SCHEDULE time by the review UI (body already baked,
 * headline/seo/embeds resolved), so this script only has to promote the draft
 * into published/ — no markdown baking is duplicated here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listNicheIds, nichePaths } from "../lib/niches.mjs";
import { recordPublishedEdit } from "./editorial-memory.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes("--dry-run");

function log(msg) {
  console.log(`[publish-due] ${msg}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

const IMG_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Drop markdown image refs that would 404 on the live site.
 *
 * Nothing upstream guarantees an image ref resolves: the model can invent a
 * filename in prose ("inline_foo_visualization.webp") that was never generated,
 * and refs can outlive their file. Both shipped — five published articles had
 * ten dead refs before this existed.
 *
 * Strips rather than blocks: publishing runs unattended every 15 minutes, and a
 * ref that points at nothing renders as a broken icon either way — holding back
 * an otherwise-good article over a missing decoration is the worse trade.
 */
function stripUnresolvableImages(draft, paths) {
  const body = draft.body_markdown;
  if (typeof body !== "string" || !body) return { body, dropped: [] };

  const dropped = [];
  const cleaned = body.replace(IMG_RE, (full, src) => {
    if (src.startsWith("http://") || src.startsWith("https://")) return full;
    if (src.startsWith("/api/content/images/")) {
      const filename = path.basename(src.split("?")[0]);
      if (fs.existsSync(path.join(paths.images, filename))) return full;
      dropped.push(src);
      return "";
    }
    // Anything else (bare filename, stray relative path) can never resolve.
    dropped.push(src);
    return "";
  });

  if (!dropped.length) return { body, dropped };
  return { body: cleaned.replace(/\n{3,}/g, "\n\n"), dropped };
}

/** Promote one scheduled draft into published/. Mirrors the website's publishDraft. */
function publish(draft, paths, now) {
  const finalSlug = draft.slug;
  const publishedSlug = `${now.slice(0, 10)}_${finalSlug}`;

  const { body, dropped } = stripUnresolvableImages(draft, paths);
  for (const src of dropped) {
    log(`  ⚠ dropped unresolvable image ref: ${src}`);
  }

  const published = {
    ...draft,
    body_markdown: body,
    status: "published",
    published_at: now,
    published_slug: publishedSlug,
  };
  delete published.publish_at;

  fs.mkdirSync(paths.published, { recursive: true });
  fs.writeFileSync(
    path.join(paths.published, `${publishedSlug}.json`),
    JSON.stringify(published, null, 2)
  );

  // Publication is the moment the editor's version becomes ground truth, so
  // that's when the gap between it and the model's draft is worth recording.
  try {
    const rec = recordPublishedEdit(published, paths);
    if (rec) log(`  ↳ recorded editorial changes for the writer to learn from`);
  } catch (err) {
    log(`  ⚠ couldn't record editorial changes: ${err.message}`);
  }
  // Clear it out of the Create queue — published/ now holds the content.
  try {
    fs.unlinkSync(path.join(paths.drafts, `${draft.id}.json`));
  } catch {
    /* already gone */
  }
  return publishedSlug;
}

function main() {
  const now = new Date().toISOString();
  let publishedCount = 0;

  for (const nicheId of listNicheIds()) {
    const paths = nichePaths(nicheId);
    if (!fs.existsSync(paths.drafts)) continue;

    for (const file of fs.readdirSync(paths.drafts)) {
      if (!file.endsWith(".json")) continue;
      const draft = readJson(path.join(paths.drafts, file));
      if (!draft || draft.status !== "scheduled" || !draft.publish_at) continue;
      if (draft.publish_at > now) continue; // not due yet

      const headline = draft.selected_headline || draft.headline_options?.[0] || draft.id;
      if (DRY) {
        log(`WOULD publish [${nicheId}] "${headline}" (was due ${draft.publish_at})`);
        publishedCount++;
        continue;
      }
      const slug = publish(draft, paths, now);
      log(`✓ published [${nicheId}] "${headline}" → ${slug}`);
      publishedCount++;
    }
  }

  if (!publishedCount) log("Nothing due.");
  // The workflow reads this to decide whether to commit.
  console.log(`PUBLISHED_COUNT=${publishedCount}`);
}

main();
