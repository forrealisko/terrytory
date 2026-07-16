/**
 * GET /api/content/images/[filename]
 * Serves local article hero images from system/content/images/.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getImagesDir } from "@/lib/article-store";
import { getNiche, resolveNiche } from "@/lib/niches";
import { verifySessionToken } from "@/lib/session";

interface RouteParams {
  params: Promise<{ filename: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { filename } = await params;

    // Prevent directory traversal attacks
    const safeFilename = path.basename(filename);

    // This route is public so the magazine can render its pictures, which means
    // it must enforce the same privacy the magazine pages do: a disabled niche
    // is not public, so its images are only served to a signed-in admin (who
    // still previews drafts through this endpoint).
    const niche = resolveNiche(req);
    if (getNiche(niche).enabled === false) {
      const session = await verifySessionToken(req.cookies.get("tt_admin")?.value);
      if (!session) return new NextResponse("Image not found", { status: 404 });
    }

    const imagesDir = getImagesDir(niche);
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
