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

/**
 * Ideas currently being turned into drafts, keyed `niche:id`.
 *
 * Generation is slow (research plus a write — observed between 30s and over two
 * minutes) and every step is a paid API call, so a second run for the same idea
 * is money spent to produce a duplicate. Both runs also write the same draft
 * file, so the slower one silently overwrites the faster one's work.
 *
 * The client disables its button, but that only covers the same page: reloading
 * or navigating away resets the button while the child keeps running, which is
 * exactly how one idea got generated twice. So the lock is held against the
 * child's lifetime, not the request's, and survives the client disconnecting.
 * In-memory is enough — generation only runs where the filesystem is writable,
 * i.e. one local server process — and a restart clearing it is the right
 * failure: a stale lock that blocks an idea forever is worse than a duplicate.
 */
const generating = new Map<string, number>();
const STALE_MS = 15 * 60_000;

export async function POST(req: NextRequest) {
  try {
    const niche = resolveNiche(req);
    const { id } = await req.json().catch(() => ({}));
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (!fs.existsSync(SCRIPTS.creativeDirector)) {
      return NextResponse.json({ error: "Creative Director script not found" }, { status: 500 });
    }

    const key = `${niche}:${id}`;
    const startedAt = generating.get(key);
    if (startedAt !== undefined) {
      // Trust the lock only for as long as a run could plausibly take, so a
      // child that died without firing close/error can't strand the idea.
      if (Date.now() - startedAt < STALE_MS) {
        const secs = Math.round((Date.now() - startedAt) / 1000);
        return NextResponse.json(
          {
            error: `Already generating this draft (started ${secs}s ago). It keeps running even if you reload — it'll appear in Create when it's done.`,
          },
          { status: 409 }
        );
      }
      generating.delete(key);
    }

    const args = [SCRIPTS.creativeDirector, "create", "--niche", niche, "--id", String(id)];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        generating.set(key, Date.now());
        const child = spawn("node", args, { cwd: SCRIPTS.contentDir, env: { ...process.env } });

        // Enqueueing to a stream whose reader has gone away throws. The child's
        // exit still has to release the lock, so never let that kill cleanup.
        const safe = (fn: () => void) => {
          try {
            fn();
          } catch {
            /* reader already gone — the child runs on regardless */
          }
        };

        child.stdout.on("data", (c: Buffer) => safe(() => controller.enqueue(encoder.encode(c.toString()))));
        child.stderr.on("data", (c: Buffer) =>
          safe(() => controller.enqueue(encoder.encode(`[stderr] ${c.toString()}`)))
        );
        child.on("close", (code) => {
          generating.delete(key);
          safe(() => controller.enqueue(encoder.encode(`\n[done ${code}]\n`)));
          safe(() => controller.close());
        });
        child.on("error", (e: Error) => {
          generating.delete(key);
          safe(() => controller.enqueue(encoder.encode(`\n[error: ${e.message}]\n`)));
          safe(() => controller.close());
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
