/**
 * POST /api/content/schedule   — schedule a draft to go live later
 * DELETE /api/content/schedule — unschedule (back to draft)
 *
 * Everything is finalized here (the review UI sends the baked body, final
 * headline/seo/embeds), so the publish cron only has to promote the draft into
 * published/ — see system/content/publish-due.mjs and
 * .github/workflows/publish-scheduled.yml (runs every 15 min).
 *
 * The draft is committed + pushed, because the cron runs against the REPO — an
 * article scheduled only on this laptop would never be seen.
 *
 * Body: { draftId, publish_at (ISO), ...overrides }
 */
import { NextRequest, NextResponse } from "next/server";
import { updateDraft } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";
import { commitAndPushContent } from "@/lib/git-publish";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const { draftId, publish_at, ...overrides } = await req.json();

    if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    if (!publish_at) return NextResponse.json({ error: "publish_at is required" }, { status: 400 });

    const when = new Date(publish_at);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "publish_at is not a valid date" }, { status: 400 });
    }
    if (when.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "publish_at is in the past" }, { status: 400 });
    }

    const updated = updateDraft(
      draftId,
      { ...overrides, status: "scheduled", publish_at: when.toISOString() },
      niche
    );
    if (!updated) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    const headline = updated.selected_headline || updated.headline_options?.[0] || "article";
    const git = commitAndPushContent(`Schedule: ${headline}`);

    return NextResponse.json({
      success: true,
      publish_at: updated.publish_at,
      pushed: git.pushed,
      detail: git.pushed
        ? "Scheduled — the publish cron will take it live."
        : `Scheduled locally. ${git.detail} (it won't go live until this is pushed)`,
    });
  } catch (err) {
    return NextResponse.json({ error: `Schedule failed: ${(err as Error).message}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const { draftId } = await req.json();
    if (!draftId) return NextResponse.json({ error: "draftId is required" }, { status: 400 });

    const updated = updateDraft(draftId, { status: "draft", publish_at: undefined }, niche);
    if (!updated) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

    const headline = updated.selected_headline || updated.headline_options?.[0] || "article";
    const git = commitAndPushContent(`Unschedule: ${headline}`);
    return NextResponse.json({ success: true, pushed: git.pushed, detail: git.detail });
  } catch (err) {
    return NextResponse.json({ error: `Unschedule failed: ${(err as Error).message}` }, { status: 500 });
  }
}
