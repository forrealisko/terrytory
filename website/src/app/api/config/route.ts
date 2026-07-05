/**
 * GET /api/config — the AI model configuration the pipeline actually uses,
 * derived from the active spend tier. Powers the Settings page.
 */
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "@/lib/niches";

const CONTENT_DIR = path.join(SYSTEM_ROOT, "content");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf-8"));
  } catch {
    return fallback;
  }
}

export async function GET() {
  const settings = readJson<{ spend_tier?: string }>("runtime-settings.json", {});
  const tiers = readJson<Record<string, Record<string, string>>>("model-tiers.json", {});
  const tierKey = settings.spend_tier && tiers[settings.spend_tier] ? settings.spend_tier : "medium";
  const active = tiers[tierKey] ?? {};

  return NextResponse.json({
    spend_tier: tierKey,
    roles: [
      { key: "writer", label: "Article Writer", model: active.writer ?? "—", note: "Writes the full article" },
      { key: "research", label: "Research", model: active.research ?? "—", note: "Live web grounding" },
      { key: "rating", label: "Rating & Ranking", model: active.rating ?? "—", note: "Scores & ranks headlines" },
      { key: "image", label: "Image Generation", model: active.image ?? "—", note: "Hero & inline images" },
    ],
    tiers,
  });
}
