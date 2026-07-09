/**
 * GET /api/content/ideas — the Creative Director's ideas for the active niche,
 * split into today's slate (proposed/created) and the reuse bank.
 */
import { NextRequest, NextResponse } from "next/server";
import { listIdeas } from "@/lib/idea-store";
import { resolveNiche } from "@/lib/niches";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const all = listIdeas(niche);
    const slate = all.filter((i) => i.status === "proposed" || i.status === "created");
    const banked = all.filter((i) => i.status === "banked");
    const chosen = all.filter((i) => i.status === "chosen");
    return NextResponse.json({
      niche,
      slate,
      banked,
      chosen,
      latestBatchId: all[0]?.batch_id ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
