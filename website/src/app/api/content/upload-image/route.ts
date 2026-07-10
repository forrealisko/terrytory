/**
 * POST /api/content/upload-image
 * Upload a real image (logo, screenshot, diagram) into a draft. Saves it to the
 * active niche's images dir and returns a URL to reference in the article body.
 *
 * Body: multipart/form-data { file: File, articleId?: string }
 *
 * Writes the FS, so local / CI only (Vercel runtime is read-only).
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getImagesDir } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

export const runtime = "nodejs";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const form = await req.formData();
    const file = form.get("file");
    const articleId = String(form.get("articleId") || "draft");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = EXT_BY_TYPE[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported image type: ${file.type || "unknown"}. Use PNG, JPG, WEBP, GIF, or SVG.` },
        { status: 415 }
      );
    }

    // Cap at 8 MB to avoid committing huge binaries.
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "Image exceeds 8 MB limit" }, { status: 413 });
    }

    const safeId = path.basename(String(articleId)).replace(/[^a-zA-Z0-9_-]/g, "");
    const filename = `upload-${safeId}-${Date.now()}.${ext}`;
    const dir = getImagesDir(niche);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), buffer);

    return NextResponse.json({
      success: true,
      filename,
      url: `/api/content/images/${filename}`,
      niche,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Upload failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
