import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { ensureNicheDirs, resolveNiche, SCRIPTS } from "@/lib/niches";

export async function POST(req: NextRequest) {
  try {
    const { url, title, starred } = await req.json();

    if (!url || !title) {
      return NextResponse.json({ error: "url and title are required" }, { status: 400 });
    }

    const nicheId = resolveNiche(req);
    const paths = ensureNicheDirs(nicheId);

    let data = { active: {} as Record<string, unknown>, processed: {} as Record<string, unknown> };
    if (fs.existsSync(paths.starred)) {
      try {
        data = JSON.parse(fs.readFileSync(paths.starred, "utf-8"));
      } catch {}
    }
    if (!data.active) data.active = {};
    if (!data.processed) data.processed = {};

    if (starred) {
      data.active[url] = { title, starred_at: new Date().toISOString() };
      if (data.processed[url]) delete data.processed[url];

      // Check if a pick already exists for this URL
      let pickExists = false;
      const pickFiles = fs.readdirSync(paths.picks).filter((f) => f.endsWith(".json"));
      for (const file of pickFiles) {
        try {
          const pick = JSON.parse(fs.readFileSync(path.join(paths.picks, file), "utf-8"));
          if ((pick.source_articles || []).some((src: { url: string }) => src.url === url)) {
            pickExists = true;
            break;
          }
        } catch {}
      }

      // No pick yet — create a priority pick and write it immediately
      if (!pickExists) {
        const pickId = crypto.randomUUID();
        const pickData = {
          id: pickId,
          niche: nicheId,
          created_at: new Date().toISOString(),
          status: "pending",
          headline: title,
          rating: 10.0,
          reasoning: "Starred by user.",
          summary: "Custom user-starred topic.",
          source_articles: [{ source_id: "starred", source_name: "Starred", title, url }],
        };
        fs.writeFileSync(path.join(paths.picks, `${pickId}.json`), JSON.stringify(pickData, null, 2));

        try {
          const out = fs.openSync(paths.generatorLog, "a");
          const child = spawn("node", [SCRIPTS.writePicked, pickId, "--niche", nicheId], {
            cwd: SCRIPTS.contentDir,
            detached: true,
            stdio: ["ignore", out, out],
          });
          child.unref();
        } catch (spawnErr) {
          console.error("Failed to spawn write-picked.mjs:", spawnErr);
        }
      }
    } else {
      delete data.active[url];

      // Clean up custom picks created for this starred URL
      const pickFiles = fs.readdirSync(paths.picks).filter((f) => f.endsWith(".json"));
      for (const file of pickFiles) {
        try {
          const filePath = path.join(paths.picks, file);
          const pick = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          const isUserStarredPick = pick.rating === 10.0 && pick.reasoning === "Starred by user.";
          const containsUrl = (pick.source_articles || []).some((src: { url: string }) => src.url === url);
          if (isUserStarredPick && containsUrl && pick.status === "pending") {
            fs.unlinkSync(filePath);
          }
        } catch {}
      }
    }

    fs.writeFileSync(paths.starred, JSON.stringify(data, null, 2));
    return NextResponse.json({ success: true, starred });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
