/**
 * POST /api/content/shipped/[folder]/publish
 * Publish a shipped article to the live blog.
 */
import { NextRequest, NextResponse } from "next/server";
import { publishShippedArticle } from "@/lib/article-store";

interface RouteContext {
  params: Promise<{ folder: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { folder } = await ctx.params;

  try {
    const published = publishShippedArticle(folder);
    if (!published) {
      return NextResponse.json(
        { error: "Shipped article not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      article: published,
      blog_url: `/blog/${published.published_slug || published.slug}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Publish failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
