/**
 * GET /api/content/shipped/[folder]/images/[filename]
 * Serve an image from a shipped article's images directory.
 */
import { NextRequest, NextResponse } from "next/server";
import { getShippedImagesDir } from "@/lib/article-store";
import fs from "node:fs";
import path from "node:path";

interface RouteContext {
  params: Promise<{ folder: string; filename: string }>;
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { folder, filename } = await ctx.params;

  const imagesDir = getShippedImagesDir(folder);
  const filePath = path.join(imagesDir, filename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(filePath);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
