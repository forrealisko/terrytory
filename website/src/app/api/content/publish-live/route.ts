/**
 * POST /api/content/publish-live
 * One-click publish: ship → publish → push. The whole reason this exists is that
 * content lives as JSON in git and Vercel's runtime FS is read-only, so the live
 * site only changes when a commit lands and Vercel rebuilds. This does that
 * commit for you.
 *
 *   1. shipDraft()             → shipped/<folder> package (kept, as before)
 *   2. publishShippedArticle() → published/<slug>.json (what the public reads)
 *   3. git add/commit/push     → Vercel redeploys → live in ~60-90s
 *
 * Body: { draftId, ...shipOverrides }   (same overrides as /api/content/ship)
 * Local/CI only — writes the FS and runs git.
 */
import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { shipDraft, publishShippedArticle } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

export const runtime = "nodejs";

/** Repo root — the app runs from website/, content lives a level up. */
function repoRoot(): string {
  const cwd = process.cwd();
  for (const c of [path.resolve(cwd, ".."), cwd]) {
    if (fs.existsSync(path.join(c, ".git"))) return c;
  }
  return path.resolve(cwd, "..");
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf-8", timeout: 60_000 }).trim();
}

/**
 * Commit + push only the content dir, so we never sweep up unrelated WIP from
 * the working tree. Returns why it didn't push rather than throwing — the
 * article is already published locally at this point.
 */
function commitAndPush(headline: string): { pushed: boolean; detail: string } {
  const root = repoRoot();
  try {
    git(root, ["add", "system/content"]);
    const staged = git(root, ["diff", "--cached", "--name-only"]);
    if (!staged) return { pushed: false, detail: "No content changes to commit (already up to date)." };
    const subject = `Publish: ${headline}`.slice(0, 72);
    git(root, ["commit", "-m", subject]);
    git(root, ["push"]);
    return { pushed: true, detail: "Pushed — Vercel is rebuilding (~60-90s)." };
  } catch (err) {
    const msg = (err as Error & { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { pushed: false, detail: `Published locally, but git push failed: ${msg.slice(0, 300)}` };
  }
}

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const body = await req.json();
    const { draftId, ...overrides } = body;
    if (!draftId) {
      return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    }

    // 1. Package into shipped/ (unchanged behaviour — the artifact is kept).
    const shipped = shipDraft(draftId, overrides, niche);
    if (!shipped) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    // 2. Promote to published/ — this is what the public magazine reads.
    const published = publishShippedArticle(shipped.folderName, niche);
    if (!published) {
      return NextResponse.json(
        { error: "Shipped, but publishing failed", folder_name: shipped.folderName },
        { status: 500 }
      );
    }

    // 3. Clear it out of the Create queue (the shipped folder + published JSON
    //    hold the content now — same as the existing publishDraft behaviour).
    try {
      const draftFile = path.join(repoRoot(), "system", "content", "niches", niche, "drafts", `${draftId}.json`);
      if (fs.existsSync(draftFile)) fs.unlinkSync(draftFile);
    } catch {
      // non-fatal — publishing already succeeded
    }

    // 4. Commit + push so the live site actually changes.
    const headline = published.selected_headline || published.headline_options?.[0] || "article";
    const git = commitAndPush(headline);

    const slug = published.published_slug || published.slug;
    return NextResponse.json({
      success: true,
      folder_name: shipped.folderName,
      slug,
      blog_url: `/blog/${slug}`,
      live_url: `https://${niche}.terrytory.xyz/${published.slug}`,
      pushed: git.pushed,
      detail: git.detail,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Publish failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
