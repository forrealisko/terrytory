/**
 * POST /api/content/generate-image
 * Generate a hero image for an article using DALL-E 3 via OpenRouter.
 *
 * Body: {
 *   prompt: string,
 *   articleId: string,
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";

function getImagesDir(): string {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, "..", "system", "content", "images"),
    path.resolve(cwd, "system", "content", "images"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Create default
  const fallback = candidates[0];
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export async function POST(req: NextRequest) {
  try {
    const { prompt, articleId } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenRouter API key not configured" },
        { status: 500 }
      );
    }

    let imageUrl = "";
    const falKey = process.env.FAL_KEY;

    if (falKey) {
      // Generate image via Fal.ai Flux Dev endpoint
      const response = await fetch(
        "https://fal.run/fal-ai/flux/dev",
        {
          method: "POST",
          headers: {
            Authorization: `Key ${falKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: `Editorial news photography style. ${prompt}. High contrast, dramatic lighting, cinematic composition. No text or watermarks.`,
            image_size: "landscape_16_9",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          {
            error: data.detail || "Fal.ai image generation failed",
            details: data,
          },
          { status: response.status }
        );
      }

      imageUrl = data.images?.[0]?.url;
    } else {
      // Fallback: Generate image via OpenRouter's DALL-E 3 endpoint
      const response = await fetch(
        "https://openrouter.ai/api/v1/images/generations",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://sys.terrytory.com",
            "X-Title": "Terrytory Content Generator",
          },
          body: JSON.stringify({
            model: "openai/dall-e-3",
            prompt: `Editorial news photography style. ${prompt}. High contrast, dramatic lighting, cinematic composition. No text or watermarks.`,
            n: 1,
            size: "1792x1024",
            quality: "standard",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              data.error?.message ||
              "Image generation failed",
            details: data,
          },
          { status: response.status }
        );
      }

      imageUrl = data.data?.[0]?.url;
    }

    if (!imageUrl) {
      return NextResponse.json(
        { error: "No image URL returned" },
        { status: 500 }
      );
    }

    // Download and save the image locally
    const imageRes = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    const imagesDir = getImagesDir();
    const filename = `hero-${articleId || "unknown"}.webp`;
    const filepath = path.join(imagesDir, filename);

    fs.writeFileSync(filepath, imageBuffer);

    // Return relative path for use in articles
    const relativePath = `/api/content/images/${filename}`;

    return NextResponse.json({
      success: true,
      image_url: relativePath,
      original_url: imageUrl,
      filename,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Image generation error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
