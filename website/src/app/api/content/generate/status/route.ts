import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { nichePaths, resolveNiche } from "@/lib/niches";

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function GET(req: NextRequest) {
  try {
    const paths = nichePaths(resolveNiche(req));

    let running = false;
    let pid: number | null = null;

    if (fs.existsSync(paths.generatorPid)) {
      try {
        pid = parseInt(fs.readFileSync(paths.generatorPid, "utf-8").trim(), 10);
        if (pid && isPidRunning(pid)) running = true;
      } catch {}
    }

    let logs = "";
    if (fs.existsSync(paths.generatorLog)) {
      try {
        logs = fs.readFileSync(paths.generatorLog, "utf-8").split("\n").slice(-80).join("\n");
      } catch {}
    }

    return NextResponse.json({ running, pid, logs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
