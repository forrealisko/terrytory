/**
 * GET/POST /api/settings — global runtime settings the content pipeline reads.
 * Persisted to system/content/runtime-settings.json.
 *
 *   spend_tier ("low" | "medium" | "best") — which model quality/cost band the
 *                                            AI agents use.
 *   vacation   (boolean)                   — freezes the daily scrape.
 *
 * Writes go through content-writer: a file write locally, a GitHub commit on
 * Vercel. That matters for vacation especially — the daily scrape reads this
 * file out of the repo, so the flag only stops a cron run once it is actually
 * committed. A local-only write would flip the dashboard and keep on spending.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "@/lib/niches";
import {
  ContentWriteError,
  canWriteFiles,
  isGitHubWriteConfigured,
  writeJson,
} from "@/lib/content-writer";

const SETTINGS_PATH = path.join(SYSTEM_ROOT, "content", "runtime-settings.json");

const DEFAULTS = {
  spend_tier: "medium" as "low" | "medium" | "best",
  vacation: false,
};

function readSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function GET() {
  return NextResponse.json({
    ...readSettings(),
    // The UI needs to know whether a write can land before it offers the toggle.
    // A switch that silently does nothing is worse than no switch at all.
    can_save: canWriteFiles() || isGitHubWriteConfigured(),
    saves_via: canWriteFiles() ? "file" : "github",
  });
}

export async function POST(req: NextRequest) {
  if (!canWriteFiles() && !isGitHubWriteConfigured()) {
    return NextResponse.json(
      {
        error:
          "This deployment can't save settings: the filesystem is read-only and GITHUB_TOKEN isn't set, so the flag would never reach the scraper. Set it locally and push, or add the token.",
      },
      { status: 501 }
    );
  }

  try {
    const body = await req.json();
    const current = readSettings();
    const next = { ...current };

    if (["low", "medium", "best"].includes(body.spend_tier)) {
      next.spend_tier = body.spend_tier;
    }
    if (typeof body.vacation === "boolean") {
      next.vacation = body.vacation;
    }

    await writeJson(
      SETTINGS_PATH,
      next,
      next.vacation !== current.vacation
        ? `chore(settings): vacation mode ${next.vacation ? "ON — pause automation" : "OFF — resume automation"}`
        : "chore(settings): update runtime settings"
    );

    return NextResponse.json({ ...next, pending: !canWriteFiles() });
  } catch (err) {
    const message = err instanceof ContentWriteError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
