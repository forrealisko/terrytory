import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ensureNicheDirs, resolveNiche, SCRIPTS } from "@/lib/niches";

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "Pick ID is required" }, { status: 400 });
    }

    const nicheId = resolveNiche(req);
    const paths = ensureNicheDirs(nicheId);

    const pickPath = path.join(paths.picks, `${id}.json`);
    if (!fs.existsSync(pickPath)) {
      return NextResponse.json({ error: `Topic pick not found for ID: ${id}` }, { status: 404 });
    }

    if (!fs.existsSync(SCRIPTS.writePicked)) {
      return NextResponse.json({ error: `Writer agent script not found` }, { status: 500 });
    }

    // Reset generator log for a fresh run
    try {
      fs.writeFileSync(paths.generatorLog, "");
    } catch (e) {
      console.error("Failed to reset generator.log:", e);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const child = spawn("node", [SCRIPTS.writePicked, id, "--niche", nicheId], {
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
    return NextResponse.json({ error: `Pick-and-write trigger failed: ${(err as Error).message}` }, { status: 500 });
  }
}
