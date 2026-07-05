/**
 * GET/POST /api/settings — global runtime settings the content pipeline reads.
 * Persisted to system/content/runtime-settings.json.
 *
 * Currently: spend_tier ("low" | "medium" | "best") — chooses which model
 * quality/cost band the AI agents use.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "@/lib/niches";

const SETTINGS_PATH = path.join(SYSTEM_ROOT, "content", "runtime-settings.json");

const DEFAULTS = {
  spend_tier: "medium" as "low" | "medium" | "best",
};

function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const current = readSettings();
    const next = { ...current };

    if (["low", "medium", "best"].includes(body.spend_tier)) {
      next.spend_tier = body.spend_tier;
    }

    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
