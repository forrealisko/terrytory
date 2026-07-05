/**
 * POST /api/content/ship
 * Ship a draft — packages it into a self-contained folder.
 * The draft is kept intact so it stays in the Create queue.
 *
 * Body: {
 *   draftId: string,
 *   selected_headline?: string,
 *   body_markdown?: string,
 *   slug?: string,
 *   seo?: Partial<ArticleSeo>,
 *   hero_image_url?: string,
 *   hero_image_alt?: string,
 *   hero_image_prompt?: string,
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import { shipDraft } from "@/lib/article-store";

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

    const result = shipDraft(draftId, overrides);

    if (!result) {
      return NextResponse.json(
        { error: "Draft not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      folder_name: result.folderName,
      folder_path: result.folderPath,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Ship failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
