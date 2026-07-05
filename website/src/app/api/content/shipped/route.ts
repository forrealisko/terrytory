/**
 * GET /api/content/shipped
 * List all shipped article folders with their metadata.
 */
import { NextResponse } from "next/server";
import { listShipped } from "@/lib/article-store";

export async function GET() {
  try {
    const articles = listShipped();
    return NextResponse.json({
      articles,
      total: articles.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to list shipped articles: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
