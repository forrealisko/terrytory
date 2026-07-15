/**
 * POST /api/scrapes/star  — { url, title, starred }
 *
 * Starring a headline puts it in the STUDIO as an idea. It used to mint a
 * rating-10 pick and immediately spawn a full draft — that's gone: a star means
 * "I want to make something from this", not "write it now".
 *
 * The star and the Studio slate are two views of one thing:
 *   star   → idea appears in the slate (or a banked one is restored)
 *   unstar → idea leaves the slate (banked, so it stays recoverable)
 * and anything already in the slate reads as starred (see ../starred).
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import crypto from "node:crypto";
import { ensureNicheDirs, resolveNiche } from "@/lib/niches";
import { listIdeas, saveIdea, updateIdea, type Idea } from "@/lib/idea-store";

export const runtime = "nodejs";

/** Marks ideas minted by starring, so unstar knows which are safe to drop. */
const STARRED_BATCH = "starred";

const ideaHasUrl = (idea: Idea, url: string) =>
  (idea.source_articles || []).some((s) => s.url === url);

export async function POST(req: NextRequest) {
  try {
    const { url, title, starred } = await req.json();
    if (!url || !title) {
      return NextResponse.json({ error: "url and title are required" }, { status: 400 });
    }

    const nicheId = resolveNiche(req);
    const paths = ensureNicheDirs(nicheId);

    // Keep the starred file as the record of explicit stars — other parts of the
    // pipeline still read it — even though star state is now also derived from
    // the slate.
    let data = { active: {} as Record<string, unknown>, processed: {} as Record<string, unknown> };
    if (fs.existsSync(paths.starred)) {
      try {
        data = JSON.parse(fs.readFileSync(paths.starred, "utf-8"));
      } catch {
        /* corrupt — start fresh */
      }
    }
    if (!data.active) data.active = {};
    if (!data.processed) data.processed = {};

    const ideas = listIdeas(nicheId);
    let ideaAction = "none";

    if (starred) {
      data.active[url] = { title, starred_at: new Date().toISOString() };
      delete data.processed[url];

      const inSlate = ideas.find(
        (i) => ideaHasUrl(i, url) && (i.status === "proposed" || i.status === "created")
      );
      const banked = ideas.find((i) => ideaHasUrl(i, url) && i.status === "banked");

      if (inSlate) {
        ideaAction = "already-in-studio";
      } else if (banked) {
        // Previously set aside — bring it back rather than duplicating it.
        updateIdea(nicheId, banked.id, { status: "proposed" });
        ideaAction = "restored";
      } else {
        const idea: Idea = {
          id: crypto.randomUUID(),
          niche: nicheId,
          batch_id: STARRED_BATCH,
          created_at: new Date().toISOString(),
          status: "proposed",
          // The planner normally picks the format; a star doesn't know one yet,
          // so default to article and let the editor change it in the Studio.
          format: "article",
          title,
          angle: "",
          rationale: "Starred by you in the Scraper.",
          priority: 1,
          source_pick_ids: [],
          source_articles: [{ source_id: "starred", source_name: "Starred", title, url }],
          draft_id: null,
          planner_model: "user-starred",
        };
        saveIdea(nicheId, idea);
        ideaAction = "created";
      }
    } else {
      delete data.active[url];

      // Unstar = take it out of the Studio. Bank rather than delete so nothing
      // is ever lost, and never touch one that already produced a draft.
      for (const idea of ideas) {
        if (!ideaHasUrl(idea, url)) continue;
        if (idea.status !== "proposed" && idea.status !== "created") continue;
        if (idea.draft_id) continue; // a draft exists — leave it alone
        updateIdea(nicheId, idea.id, { status: "banked" });
        ideaAction = idea.batch_id === STARRED_BATCH ? "removed" : "banked";
      }
    }

    fs.writeFileSync(paths.starred, JSON.stringify(data, null, 2));
    return NextResponse.json({ success: true, starred, idea: ideaAction });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
