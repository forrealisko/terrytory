import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureNicheDirs, resolveNiche, SCRIPTS } from "@/lib/niches";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { model } = await req.json();
    const nicheId = resolveNiche(req);
    const paths = ensureNicheDirs(nicheId);
    const draftPath = path.join(paths.drafts, `${id}.json`);

    if (!fs.existsSync(draftPath)) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    const draftData = JSON.parse(fs.readFileSync(draftPath, "utf-8"));
    draftData.status = "generating";
    fs.writeFileSync(draftPath, JSON.stringify(draftData, null, 2));

    const args = [SCRIPTS.writePicked, id];
    if (model) args.push(model);
    args.push("--niche", nicheId);

    const out = fs.openSync(paths.generatorLog, "a");
    const child = spawn("node", args, {
      cwd: SCRIPTS.contentDir,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();

    return NextResponse.json({ success: true, message: "Regeneration started" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
