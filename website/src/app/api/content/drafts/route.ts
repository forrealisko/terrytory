/**
 * GET  /api/content/drafts    — List all pending drafts
 * POST /api/content/drafts    — Manually trigger article generation (optional body)
 */
import { NextRequest, NextResponse } from "next/server";
import { listDrafts } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

export async function GET(req: NextRequest) {
  try {
    const drafts = listDrafts(resolveNiche(req));
    return NextResponse.json({ drafts, total: drafts.length });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list drafts: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // Trigger on-demand generation by calling the generate endpoint
  // This is a convenience redirect
  const body = await req.json().catch(() => ({}));

  try {
    const generateUrl = new URL("/api/content/generate", req.url);
    const res = await fetch(generateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: `Trigger failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
