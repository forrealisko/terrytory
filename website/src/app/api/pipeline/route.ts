/**
 * GET /api/pipeline — live counts for each stage of the active niche's pipeline.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ensureNicheDirs, getNiche, resolveNiche } from "@/lib/niches";

function countJson(dir: string, filter?: (d: Record<string, unknown>) => boolean): number {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (!filter) return files.length;
    let n = 0;
    for (const f of files) {
      try {
        if (filter(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")))) n++;
      } catch {}
    }
    return n;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  try {
    const nicheId = resolveNiche(req);
    const niche = getNiche(nicheId);
    const paths = ensureNicheDirs(nicheId);

    // Scraped: total headlines + new in the latest digest
    let scraped = 0;
    let scrapedNew = 0;
    for (const source of niche.sources) {
      try {
        const latest = JSON.parse(
          fs.readFileSync(path.join(paths.scraperData, source.id, "latest.json"), "utf-8")
        );
        scraped += latest.meta?.total_headlines ?? 0;
        scrapedNew += latest.meta?.new_headlines ?? 0;
      } catch {}
    }

    const picks = countJson(paths.picks, (d) => d.status === "pending");
    const drafts = countJson(paths.drafts, (d) => d.status === "draft" || d.status === "generating");
    const published = countJson(paths.published);

    return NextResponse.json({
      niche: nicheId,
      stages: { scraped, scrapedNew, picks, drafts, published },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
