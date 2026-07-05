import { NextResponse } from "next/server";
import { fileURLToPath } from "node:url";

const getPath = () => eval("require('node:path')");
const getFS = () => eval("require('node:fs')");

function getContentDir(): string {
  const path = getPath();
  const fs = getFS();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const resolved = path.resolve(currentDir, "..", "..", "..", "..", "..", "system", "content");
  if (fs.existsSync(resolved)) return resolved;
  return path.resolve(process.cwd(), "..", "system", "content");
}

export async function GET() {
  try {
    const path = getPath();
    const fs = getFS();
    const contentDir = getContentDir();
    const statusPath = path.join(contentDir, "scheduler-status.json");

    if (!fs.existsSync(statusPath)) {
      return NextResponse.json({
        active: false,
        status: "inactive",
        message: "Scheduler status file not found."
      });
    }

    const raw = fs.readFileSync(statusPath, "utf-8");
    const data = JSON.parse(raw);

    // Validate heartbeat (must be less than 90 seconds old to be considered active)
    let active = false;
    if (data.heartbeat) {
      const elapsed = Date.now() - new Date(data.heartbeat).getTime();
      active = elapsed < 90000; // 90 seconds
    }

    return NextResponse.json({
      active,
      ...data
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, active: false }, { status: 500 });
  }
}
