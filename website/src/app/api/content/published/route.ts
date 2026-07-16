/**
 * GET /api/content/published
 * List published articles with pagination.
 *
 * Query params:
 *   ?page=1&limit=20
 */
import { NextRequest, NextResponse } from "next/server";
import { listPublished } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

export async function GET(req: NextRequest) {
  try {
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);

    // Without the niche this fell back to the default, so the Published screen
    // showed "ai" no matter which niche the sidebar had selected.
    const result = listPublished(page, limit, resolveNiche(req));

    return NextResponse.json({
      articles: result.articles,
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list published: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
