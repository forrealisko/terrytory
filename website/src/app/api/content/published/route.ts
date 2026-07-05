/**
 * GET /api/content/published
 * List published articles with pagination.
 *
 * Query params:
 *   ?page=1&limit=20
 */
import { NextRequest, NextResponse } from "next/server";
import { listPublished } from "@/lib/article-store";

export async function GET(req: NextRequest) {
  try {
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20", 10);

    const result = listPublished(page, limit);

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
