/**
 * GET /api/scrapes/starred → { starred: string[] }  (urls)
 *
 * Star state is the union of:
 *   1. explicit stars (starred-scrapes.json), and
 *   2. every source url behind an idea currently in the Studio slate.
 *
 * (2) is what makes "anything in the Studio shows as starred in the Scraper"
 * true automatically — including planner-generated ideas nobody starred by hand.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { nichePaths, resolveNiche } from "@/lib/niches";
import { listIdeas } from "@/lib/idea-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const paths = nichePaths(niche);
    const urls = new Set<string>();

    // 1. Explicit stars.
    if (fs.existsSync(paths.starred)) {
      try {
        const data = JSON.parse(fs.readFileSync(paths.starred, "utf-8"));
        for (const u of Object.keys(data.active || {})) urls.add(u);
      } catch {
        /* corrupt — fall through to the slate */
      }
    }

    // 2. Anything sitting in the Studio slate.
    for (const idea of listIdeas(niche)) {
      if (idea.status !== "proposed" && idea.status !== "created") continue;
      for (const src of idea.source_articles || []) {
        if (src.url) urls.add(src.url);
      }
    }

    return NextResponse.json({ starred: [...urls] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
