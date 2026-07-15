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
import path from "node:path";
import fs from "node:fs";
import { shipDraft, publishShippedArticle } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";
import { repoRoot, commitAndPushContent } from "@/lib/git-publish";

export const runtime = "nodejs";

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
    const git = commitAndPushContent(`Publish: ${headline}`);

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
