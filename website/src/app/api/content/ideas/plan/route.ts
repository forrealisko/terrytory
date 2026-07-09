/**
 * POST /api/content/ideas/plan — run the Creative Director to propose today's
 * slate (2-5 scenarios) for the active niche. Streams the agent's log.
 *
 * Body: { count?: number }  // omit/0 = let the AI decide 2-5
 *
 * Spawns a node process (writes files), so this runs locally / in CI — not on
 * the read-only Vercel runtime.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolveNiche, SCRIPTS } from "@/lib/niches";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const body = await req.json().catch(() => ({}));
    const count = Number.parseInt(String(body?.count ?? ""), 10);

    if (!fs.existsSync(SCRIPTS.creativeDirector)) {
      return NextResponse.json({ error: "Creative Director script not found" }, { status: 500 });
    }

    const args = [SCRIPTS.creativeDirector, "plan", "--niche", niche];
    if (Number.isFinite(count) && count >= 2 && count <= 5) args.push("--count", String(count));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const child = spawn("node", args, { cwd: SCRIPTS.contentDir, env: { ...process.env } });
        child.stdout.on("data", (c: Buffer) => controller.enqueue(encoder.encode(c.toString())));
        child.stderr.on("data", (c: Buffer) => controller.enqueue(encoder.encode(`[stderr] ${c.toString()}`)));
        child.on("close", (code) => {
          controller.enqueue(encoder.encode(`\n[done ${code}]\n`));
          controller.close();
        });
        child.on("error", (e: Error) => {
          controller.enqueue(encoder.encode(`\n[error: ${e.message}]\n`));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
