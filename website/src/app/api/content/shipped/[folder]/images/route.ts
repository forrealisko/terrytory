/**
 * POST /api/content/shipped/[folder]/images
 * Upload an image to a shipped article's images directory.
 */
import { NextRequest, NextResponse } from "next/server";
import { getShippedImagesDir } from "@/lib/article-store";
import fs from "node:fs";
import path from "node:path";

interface RouteContext {
  params: Promise<{ folder: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { folder } = await ctx.params;

  try {
    const imagesDir = getShippedImagesDir(folder);
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(imagesDir, safeName);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({
      success: true,
      filename: safeName,
      path: `/api/content/shipped/${folder}/images/${safeName}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
