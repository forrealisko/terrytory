/**
 * POST /api/content/ideas/status — flip an idea's lifecycle state.
 *
 * Body: { id: string, action: "choose" | "bank" | "restore" }
 *   choose  → mark this idea "chosen"; bank the rest of its batch (pick the best,
 *             keep the others for later).
 *   bank    → mark "banked" (reuse pool).
 *   restore → bring a banked idea back to "proposed" (today's slate).
 *
 * Writes the FS, so local / CI only (Vercel runtime is read-only).
 */
import { NextRequest, NextResponse } from "next/server";
import { getIdea, listIdeas, updateIdea } from "@/lib/idea-store";
import { resolveNiche } from "@/lib/niches";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const { id, action } = await req.json().catch(() => ({}));
    if (!id || !action) {
      return NextResponse.json({ error: "id and action are required" }, { status: 400 });
    }

    const idea = getIdea(niche, id);
    if (!idea) return NextResponse.json({ error: "Idea not found" }, { status: 404 });

    try {
      if (action === "choose") {
        updateIdea(niche, id, { status: "chosen" });
        // Bank the rest of the batch — the runners-up we can use another day.
        let banked = 0;
        for (const sib of listIdeas(niche)) {
          if (sib.batch_id === idea.batch_id && sib.id !== id && (sib.status === "proposed" || sib.status === "created")) {
            updateIdea(niche, sib.id, { status: "banked" });
            banked++;
          }
        }
        return NextResponse.json({ ok: true, status: "chosen", bankedSiblings: banked });
      }

      if (action === "bank") {
        updateIdea(niche, id, { status: "banked" });
        return NextResponse.json({ ok: true, status: "banked" });
      }

      if (action === "restore") {
        updateIdea(niche, id, { status: "proposed" });
        return NextResponse.json({ ok: true, status: "proposed" });
      }

      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    } catch (e) {
      // Read-only FS (e.g. Vercel) — surface a clear message.
      return NextResponse.json({ error: `Could not update idea: ${(e as Error).message}` }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
