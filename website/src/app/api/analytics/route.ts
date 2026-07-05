/**
 * GET /api/analytics — operational overview for the active niche:
 * articles scraped today, drafts in review, published, and estimated AI spend.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getNiche, nichePaths, resolveNiche } from "@/lib/niches";

// Rough OpenRouter/provider pricing, USD per 1M tokens: [input, output].
// Matched by substring against the model id recorded on each draft.
const PRICING: Array<[string, number, number]> = [
  ["claude-sonnet", 3, 15],
  ["claude-3.5-sonnet", 3, 15],
  ["claude-haiku", 0.8, 4],
  ["gemini-2.5-flash", 0.3, 2.5],
  ["gemini-flash", 0.3, 2.5],
  ["gpt-4o-mini", 0.15, 0.6],
  ["gpt-4o", 2.5, 10],
  ["deepseek", 0.14, 0.28],
];
const DEFAULT_PRICE: [number, number] = [1, 3];
const IMAGE_COST = 0.03; // flat per generated image (Flux Dev / DALL·E est.)

function priceFor(model: string): [number, number] {
  const m = (model || "").toLowerCase();
  for (const [key, i, o] of PRICING) if (m.includes(key)) return [i, o];
  return DEFAULT_PRICE;
}

const today = () => new Date().toISOString().slice(0, 10);
const isToday = (iso?: string) => typeof iso === "string" && iso.slice(0, 10) === today();

function readJsonDir(dir: string): Record<string, unknown>[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        } catch {
          return null;
        }
      })
      .filter((x): x is Record<string, unknown> => x !== null);
  } catch {
    return [];
  }
}

function tokenSpend(records: Record<string, unknown>[]) {
  let cost = 0;
  let inTok = 0;
  let outTok = 0;
  for (const r of records) {
    const g = (r.generation ?? {}) as { model?: string; prompt_tokens?: number; completion_tokens?: number };
    const pt = g.prompt_tokens ?? (r.prompt_tokens as number) ?? 0;
    const ct = g.completion_tokens ?? (r.completion_tokens as number) ?? 0;
    const [pi, po] = priceFor(g.model ?? (r.model as string) ?? "");
    cost += (pt / 1e6) * pi + (ct / 1e6) * po;
    inTok += pt;
    outTok += ct;
  }
  return { cost, inTok, outTok };
}

export async function GET(req: NextRequest) {
  try {
    const nicheId = resolveNiche(req);
    const niche = getNiche(nicheId);
    const paths = nichePaths(nicheId);

    // ── Scraping ──
    let scrapedTotal = 0;
    let scrapedToday = 0;
    const sources = niche.sources.map((src) => {
      let total = 0;
      let scraped_at: string | null = null;
      try {
        const latest = JSON.parse(fs.readFileSync(paths.sourceLatest(src.id), "utf-8"));
        total = latest.meta?.total_headlines ?? latest.headlines?.length ?? 0;
        scraped_at = latest.meta?.scraped_at ?? null;
        scrapedTotal += total;
        for (const h of latest.headlines ?? []) if (isToday(h.first_seen)) scrapedToday++;
      } catch {}
      return { id: src.id, name: src.name, color: src.color ?? "#00e676", total, scraped_at };
    });

    // ── Drafts (in review / edited) ──
    const drafts = readJsonDir(paths.drafts);
    const draftsCount = drafts.filter(
      (d) => d.status === "draft" || d.status === "generating"
    ).length;

    // ── Published ──
    const published = readJsonDir(paths.published);
    const publishedTotal = published.length;
    const publishedToday = published.filter(
      (p) => isToday((p.published_at as string) ?? (p.shipped_at as string) ?? (p.created_at as string))
    ).length;

    // ── AI spend ──
    const all = [...drafts, ...published];
    const { cost: tokenCost, inTok, outTok } = tokenSpend(all);
    const todayCost = tokenSpend(all.filter((r) => isToday(r.created_at as string))).cost;

    let imageCount = 0;
    try {
      imageCount = fs.readdirSync(paths.images).filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f)).length;
    } catch {}
    const imageCost = imageCount * IMAGE_COST;

    return NextResponse.json({
      niche: nicheId,
      scraped: { today: scrapedToday, total: scrapedTotal },
      drafts: draftsCount,
      published: { today: publishedToday, total: publishedTotal },
      spend: {
        total: +(tokenCost + imageCost).toFixed(2),
        today: +todayCost.toFixed(2),
        tokens: { input: inTok, output: outTok },
        images: imageCount,
      },
      sources,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
