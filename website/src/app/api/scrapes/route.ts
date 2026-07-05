/**
 * GET  /api/scrapes — latest scrape data for the active niche's sources.
 * POST /api/scrapes — run the scraper engine for the active niche (streamed).
 *
 * Niche resolution: ?niche= param → "niche" cookie → default.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { getNiche, nichePaths, resolveNiche, SCRIPTS, type NicheSource } from "@/lib/niches";
import { getContentBase2 } from "@/lib/article-store";
import path from "node:path";

interface Headline {
  type: string;
  title: string;
  url: string;
  image_url?: string | null;
  article_date?: string | null;
  article_date_raw?: string | null;
  author?: string | null;
  excerpt?: string | null;
  date_analysis?: { relative: string; age_days: number | null; parsed: string | null };
  interest_score?: number;
  is_new: boolean;
  first_seen: string;
  categories?: string[];
  tags?: string[];
  starred?: boolean;
}

interface ScrapePayload {
  meta: {
    scrape_id: string;
    scraped_at: string;
    source_url: string;
    total_headlines: number;
    new_headlines: number;
    previously_seen: number;
    [key: string]: unknown;
  };
  headlines: Headline[];
}

function getActiveStars(niche: string): Set<string> {
  const stars = new Set<string>();
  try {
    const starredPath = path.join(getContentBase2(niche), "starred-scrapes.json");
    if (fs.existsSync(starredPath)) {
      const data = JSON.parse(fs.readFileSync(starredPath, "utf-8"));
      if (data.active) Object.keys(data.active).forEach((url) => stars.add(url));
    }
  } catch (err) {
    console.error("Failed to read active stars:", err);
  }
  return stars;
}

function readSource(niche: string, source: NicheSource, activeStars: Set<string>) {
  const paths = nichePaths(niche);
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.sourceLatest(source.id), "utf-8")) as ScrapePayload;
    if (parsed?.headlines) {
      parsed.headlines = parsed.headlines.map((h) => ({ ...h, starred: activeStars.has(h.url) }));
    }
    return { source, data: parsed as ScrapePayload | null, error: undefined as string | undefined };
  } catch (err) {
    return {
      source,
      data: null,
      error: `Could not read ${source.name}: ${(err as Error).message}`,
    };
  }
}

export async function GET(req: NextRequest) {
  const nicheId = resolveNiche(req);
  const niche = getNiche(nicheId);
  const sourceParam = req.nextUrl.searchParams.get("source");
  const activeStars = getActiveStars(nicheId);

  if (sourceParam) {
    const source = niche.sources.find((s) => s.id === sourceParam);
    if (source) {
      const result = readSource(nicheId, source, activeStars);
      if (!result.data) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        source: { id: source.id, name: source.name, color: source.color },
        ...result.data,
      });
    }
  }

  const sources = niche.sources.map((src) => {
    const result = readSource(nicheId, src, activeStars);
    return {
      id: src.id,
      name: src.name,
      color: src.color,
      scraped_at: result.data?.meta?.scraped_at ?? null,
      total_headlines: result.data?.meta?.total_headlines ?? 0,
      error: result.error ?? null,
      headlines: (result.data?.headlines ?? []).map((h) => ({
        ...h,
        _source_id: src.id,
        _source_name: src.name,
        _source_color: src.color,
        starred: activeStars.has(h.url),
      })),
    };
  });

  const allHeadlines = sources
    .flatMap((s) => s.headlines)
    .sort((a, b) => {
      // Primary: AI interest score (desc). Fall back to recency when unscored.
      const sa = typeof a.interest_score === "number" ? a.interest_score : -1;
      const sb = typeof b.interest_score === "number" ? b.interest_score : -1;
      if (sa !== sb) return sb - sa;
      return new Date(b.first_seen || 0).getTime() - new Date(a.first_seen || 0).getTime();
    });

  return NextResponse.json({
    niche: nicheId,
    sources: sources.map(({ headlines: _headlines, ...rest }) => rest),
    total: allHeadlines.length,
    headlines: allHeadlines,
  });
}

export async function POST(req: NextRequest) {
  try {
    const nicheId = resolveNiche(req);
    const paths = nichePaths(nicheId);

    if (!fs.existsSync(SCRIPTS.scrape)) {
      return NextResponse.json(
        { error: `Scraper engine not found at ${SCRIPTS.scrape}` },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const child = spawn("node", [SCRIPTS.scrape, "--niche", nicheId], {
          cwd: path.dirname(SCRIPTS.scrape),
          env: { ...process.env, HEADLESS: "true" },
        });

        try {
          fs.mkdirSync(paths.scraperData, { recursive: true });
          fs.writeFileSync(paths.scraperPid, String(child.pid));
        } catch (pidErr) {
          console.error("Failed to write scraper PID:", pidErr);
        }

        child.stdout.on("data", (chunk: Buffer) => {
          controller.enqueue(encoder.encode(chunk.toString()));
        });
        child.stderr.on("data", (chunk: Buffer) => {
          controller.enqueue(encoder.encode(`[stderr] ${chunk.toString()}`));
        });
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
    return NextResponse.json({ error: `Scrape failed: ${(err as Error).message}` }, { status: 500 });
  }
}
