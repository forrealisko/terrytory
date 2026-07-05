/**
 * GET    /api/content/drafts/:id  — Get single draft
 * PUT    /api/content/drafts/:id  — Update draft fields
 * DELETE /api/content/drafts/:id  — Reject/archive draft
 */
import { NextRequest, NextResponse } from "next/server";
import { getDraft, updateDraft, rejectDraft } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const draft = getDraft(id, resolveNiche(req));
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: `Failed to get draft: ${(err as Error).message}` }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const updates = await req.json();
    const updated = updateDraft(id, updates, resolveNiche(req));
    if (!updated) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: `Failed to update draft: ${(err as Error).message}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const rejected = rejectDraft(id, resolveNiche(req));
    if (!rejected) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json({ success: true, message: "Draft rejected" });
  } catch (err) {
    return NextResponse.json({ error: `Failed to reject draft: ${(err as Error).message}` }, { status: 500 });
  }
}
