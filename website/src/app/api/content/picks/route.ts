import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ensureNicheDirs, resolveNiche } from "@/lib/niches";

export async function GET(req: NextRequest) {
  try {
    const paths = ensureNicheDirs(resolveNiche(req));

    const files = fs.readdirSync(paths.picks).filter((f) => f.endsWith(".json"));
    const picks = [];

    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(paths.picks, f), "utf-8"));
        if (data.status === "pending") picks.push(data);
      } catch {}
    }

    picks.sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json({ picks, total: picks.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
