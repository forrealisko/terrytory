/**
 * GET /api/content/images/[filename]
 * Serves local article hero images from system/content/images/.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getImagesDir } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";

interface RouteParams {
  params: Promise<{ filename: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { filename } = await params;

    // Prevent directory traversal attacks
    const safeFilename = path.basename(filename);

    const imagesDir = getImagesDir(resolveNiche(req));
    const filepath = path.join(imagesDir, safeFilename);

    if (!fs.existsSync(filepath)) {
      return new NextResponse("Image not found", { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filepath);

    // Determine content type
    let contentType = "image/webp";
    if (safeFilename.endsWith(".png")) {
      contentType = "image/png";
    } else if (safeFilename.endsWith(".jpg") || safeFilename.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (safeFilename.endsWith(".svg")) {
      contentType = "image/svg+xml";
    }

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return new NextResponse(`Error serving image: ${(err as Error).message}`, {
      status: 500,
    });
  }
}
