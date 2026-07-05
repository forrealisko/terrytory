/**
 * GET /api/content/shipped/[folder]  — Read a shipped article folder
 * PUT /api/content/shipped/[folder]  — Update markdown, meta, or formatting
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getShippedArticle,
  updateShippedArticle,
} from "@/lib/article-store";

interface RouteContext {
  params: Promise<{ folder: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { folder } = await ctx.params;

  const data = getShippedArticle(folder);
  if (!data) {
    return NextResponse.json({ error: "Shipped article not found" }, { status: 404 });
  }

  return NextResponse.json({
    folder_name: folder,
    ...data,
  });
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { folder } = await ctx.params;

  try {
    const body = await req.json();
    const ok = updateShippedArticle(folder, body);
    if (!ok) {
      return NextResponse.json({ error: "Shipped article not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Update failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
