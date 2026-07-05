import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { nichePaths, resolveNiche } from "@/lib/niches";

export async function GET(req: NextRequest) {
  try {
    const paths = nichePaths(resolveNiche(req));

    if (!fs.existsSync(paths.starred)) {
      return NextResponse.json({ starred: [] });
    }

    const data = JSON.parse(fs.readFileSync(paths.starred, "utf-8"));
    return NextResponse.json({ starred: Object.keys(data.active || {}) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
