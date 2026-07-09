/**
 * POST /api/content/ideas/create — turn one idea into a full draft (research +
 * format-aware write + images). Streams the agent's log. The draft lands in the
 * CREATE queue; the idea is marked "created" with its draft_id.
 *
 * Body: { id: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { resolveNiche, SCRIPTS } from "@/lib/niches";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const { id } = await req.json().catch(() => ({}));
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (!fs.existsSync(SCRIPTS.creativeDirector)) {
      return NextResponse.json({ error: "Creative Director script not found" }, { status: 500 });
    }

    const args = [SCRIPTS.creativeDirector, "create", "--niche", niche, "--id", String(id)];
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
