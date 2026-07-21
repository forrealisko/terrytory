/**
 * GET /api/content/goal — published-article count across enabled niches, plus
 * the next milestone. Feeds the admin's progress bar.
 *
 * Milestones are 20 → 50 → 100: the rough thresholds where a site starts being
 * treated as a real publication, then a substantial one. Read-only; safe on
 * Vercel.
 */
import { NextResponse } from "next/server";
import { listNiches } from "@/lib/niches";
import { listPublished } from "@/lib/article-store";

const MILESTONES = [20, 50, 100];

export async function GET() {
  const perNiche: Record<string, number> = {};
  let total = 0;

  for (const n of listNiches()) {
    if (n.enabled === false) continue; // a disabled niche isn't public — don't count it
    const count = listPublished(1, 1000, n.id).total;
    perNiche[n.id] = count;
    total += count;
  }

  const next = MILESTONES.find((m) => m > total) ?? null;
  const prev = [...MILESTONES].reverse().find((m) => m <= total) ?? 0;

  return NextResponse.json({
    total,
    perNiche,
    milestones: MILESTONES,
    next,
    prevMilestone: prev,
    remaining: next ? next - total : 0,
  });
}
