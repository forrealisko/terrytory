/**
 * POST /api/content/generate-variations
 * Generate several image variations for one article image-brief slot via fal.ai,
 * so the editor can pick the best one from a gallery. Unlike generate-image
 * (which commits a single hero-<id>.webp), this saves each candidate under a
 * unique filename and returns them all — nothing is placed until the user picks.
 *
 * Body: {
 *   prompt: string,        // the image brief / description
 *   articleId: string,
 *   slotId?: string,       // e.g. "IMG2" (for filenames)
 *   kind?: string,         // hero|photo|screenshot|comparison|diagram|logo
 *   model?: string,        // key from MODELS below
 *   count?: number,        // 1..4, default 3
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { getImagesDir } from "@/lib/article-store";
import { resolveNiche } from "@/lib/niches";
import { buildImagePrompt } from "@/lib/image-style";

export const runtime = "nodejs";

// Allowlisted fal.ai endpoints. Keep keys stable — the UI sends these.
const MODELS: Record<string, { endpoint: string; label: string }> = {
  "flux-dev": { endpoint: "fal-ai/flux/dev", label: "Flux Dev" },
  "flux-schnell": { endpoint: "fal-ai/flux/schnell", label: "Flux Schnell" },
  "flux-pro": { endpoint: "fal-ai/flux-pro/v1.1", label: "Flux 1.1 Pro" },
};
const DEFAULT_MODEL = "flux-dev";

function slug(s: string): string {
  return (s || "").replace(/[^a-z0-9]+/gi, "").slice(0, 12) || "img";
}

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const { prompt, articleId, slotId, kind, model, count } = await req.json();

    if (!prompt || !String(prompt).trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const falKey = process.env.FAL_KEY;
    if (!falKey) {
      return NextResponse.json(
        { error: "FAL_KEY not configured — add it to website/.env.local to generate images." },
        { status: 500 }
      );
    }

    const modelKey = MODELS[model] ? model : DEFAULT_MODEL;
    const { endpoint } = MODELS[modelKey];
    const n = Math.max(1, Math.min(4, Number(count) || 3));

    const response = await fetch(`https://fal.run/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // House style + art direction for this kind of visual + the brief.
        prompt: buildImagePrompt(prompt, kind),
        // Diagrams/logos read better square; everything else is a 16:9 band.
        image_size: kind === "diagram" || kind === "logo" ? "square_hd" : "landscape_16_9",
        num_images: n,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || data.error || "fal.ai generation failed", details: data },
        { status: response.status }
      );
    }

    const remoteImages: { url: string }[] = data.images || [];
    if (remoteImages.length === 0) {
      return NextResponse.json({ error: "No images returned" }, { status: 502 });
    }

    // Download + persist each candidate into the active niche's images dir
    // (same dir /api/content/images/[filename] serves from).
    const imagesDir = getImagesDir(niche);
    fs.mkdirSync(imagesDir, { recursive: true });
    const ts = Date.now();
    const saved: { url: string; original_url: string }[] = [];

    for (let i = 0; i < remoteImages.length; i++) {
      const remote = remoteImages[i]?.url;
      if (!remote) continue;
      try {
        const imgRes = await fetch(remote);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const filename = `gen-${slug(articleId || "unknown")}-${slug(slotId || "slot")}-${ts}-${i}.webp`;
        fs.writeFileSync(path.join(imagesDir, filename), buf);
        saved.push({ url: `/api/content/images/${filename}`, original_url: remote });
      } catch {
        // skip a failed download but keep the rest
      }
    }

    if (saved.length === 0) {
      return NextResponse.json({ error: "Failed to save generated images" }, { status: 500 });
    }

    return NextResponse.json({ success: true, model: modelKey, images: saved });
  } catch (err) {
    return NextResponse.json(
      { error: `Generation error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
