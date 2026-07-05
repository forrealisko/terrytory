/**
 * POST /api/content/generate
 * On-demand generation for the active niche: rates the latest digest
 * into picks (streamed output). Drafts are then written from picks.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { ensureNicheDirs, resolveNiche, SCRIPTS } from "@/lib/niches";

export async function POST(req: NextRequest) {
  try {
    const nicheId = resolveNiche(req);
    const paths = ensureNicheDirs(nicheId);

    if (!fs.existsSync(SCRIPTS.rate)) {
      return NextResponse.json({ error: `Generator script not found at ${SCRIPTS.rate}` }, { status: 500 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const child = spawn("node", [SCRIPTS.rate, "--niche", nicheId], {
          cwd: SCRIPTS.contentDir,
          env: { ...process.env },
        });

        try {
          fs.writeFileSync(paths.generatorPid, String(child.pid));
        } catch (pidErr) {
          console.error("Failed to write generator PID:", pidErr);
        }

        child.stdout.on("data", (chunk: Buffer) => controller.enqueue(encoder.encode(chunk.toString())));
        child.stderr.on("data", (chunk: Buffer) => controller.enqueue(encoder.encode(`[stderr] ${chunk.toString()}`)));
        child.on("close", (code: number | null) => {
          controller.enqueue(encoder.encode(`\n[process exited with code ${code}]\n`));
          controller.close();
        });
        child.on("error", (err: Error) => {
          controller.enqueue(encoder.encode(`\n[process error: ${err.message}]\n`));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `Generation failed: ${(err as Error).message}` }, { status: 500 });
  }
}
