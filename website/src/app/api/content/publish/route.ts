/**
 * POST /api/content/publish
 * Publish a draft — moves it from drafts/ to published/.
 *
 * Body: {
 *   draftId: string,
 *   selected_headline?: string,
 *   body_markdown?: string,
 *   slug?: string,
 *   seo?: Partial<ArticleSeo>,
 *   hero_image_url?: string,
 *   hero_image_alt?: string,
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { publishDraft } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { draftId, ...overrides } = body;

    if (!draftId) {
      return NextResponse.json(
        { error: "draftId is required" },
        { status: 400 }
      );
    }

    const published = publishDraft(draftId, overrides, resolveNiche(req));

    if (!published) {
      return NextResponse.json(
        { error: "Draft not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      article: published,
      blog_url: `/blog/${published.slug}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Publish failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
