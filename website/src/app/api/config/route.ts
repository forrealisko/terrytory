/**
 * GET /api/config — the AI model configuration the pipeline actually uses,
 * derived from the active spend tier. Powers the Settings page.
 *
 * POST /api/config — update the spend tier (persists to runtime-settings.json).
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "@/lib/niches";

const CONTENT_DIR = path.join(SYSTEM_ROOT, "content");
const SETTINGS_PATH = path.join(CONTENT_DIR, "runtime-settings.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8"));
  } catch {
    return fallback;
  }
}

function buildResponse(tierKey: string, tiers: Record<string, Record<string, string>>) {
  const active = tiers[tierKey] ?? {};
  return {
    spend_tier: tierKey,
    roles: [
      { key: "writer", label: "Article Writer", model: active.writer ?? "—", note: "Writes the full article" },
      { key: "research", label: "Research", model: active.research ?? "—", note: "Live web grounding" },
      { key: "rating", label: "Rating & Ranking", model: active.rating ?? "—", note: "Scores & ranks headlines" },
      { key: "image", label: "Image Generation", model: active.image ?? "—", note: "Hero & inline images" },
    ],
    tiers,
  };
}

export async function GET() {
  const settings = readJson<{ spend_tier?: string }>("runtime-settings.json", {});
  const tiers = readJson<Record<string, Record<string, string>>>("model-tiers.json", {});
  const tierKey = settings.spend_tier && tiers[settings.spend_tier] ? settings.spend_tier : "medium";
  return NextResponse.json(buildResponse(tierKey, tiers));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const requested = body.spend_tier;
    const tiers = readJson<Record<string, Record<string, string>>>("model-tiers.json", {});

    if (!requested || !tiers[requested]) {
      return NextResponse.json(
        { error: `Invalid tier "${requested}". Valid: ${Object.keys(tiers).join(", ")}` },
        { status: 400 }
      );
    }

    // Read existing settings, update the tier, and write back
    const settings = readJson<Record<string, unknown>>("runtime-settings.json", {});
    settings.spend_tier = requested;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

    return NextResponse.json(buildResponse(requested, tiers));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
