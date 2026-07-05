/**
 * GET /api/niches — list all niches + which one is active for this client.
 */
import { NextRequest, NextResponse } from "next/server";
import { listNiches, resolveNiche } from "@/lib/niches";

export async function GET(req: NextRequest) {
  try {
    const active = resolveNiche(req);
    const niches = listNiches()
      .filter((n) => n.enabled !== false)
      .map((n) => ({
      id: n.id,
      enabled: n.enabled !== false,
      name: n.brand?.name || n.id,
      shortName: n.brand?.shortName || n.brand?.name || n.id,
      tagline: n.brand?.tagline || "",
      accent: n.brand?.accent || "#00e676",
      monetization: n.monetization?.mode || "none",
      sources: n.sources.map((s) => ({ id: s.id, name: s.name, color: s.color, type: s.type })),
    }));
    return NextResponse.json({ niches, active });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
