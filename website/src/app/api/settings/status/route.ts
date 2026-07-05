import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "@/lib/niches";

// Read proxy config from system/.env without exposing credentials.
function readProxyStatus() {
  try {
    const env = fs.readFileSync(path.join(SYSTEM_ROOT, ".env"), "utf-8");
    const get = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
    return {
      proxy_enabled: (get("PROXY_ENABLED") || "").toLowerCase() === "true",
      proxy_host: get("BRIGHTDATA_HOST") || null,
      proxy_port: get("BRIGHTDATA_PORT") || null,
    };
  } catch {
    return { proxy_enabled: false, proxy_host: null, proxy_port: null };
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      fal_connected: !!process.env.FAL_KEY,
      openrouter_connected: !!process.env.OPENROUTER_API_KEY,
      ...readProxyStatus(),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
