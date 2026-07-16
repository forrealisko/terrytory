/**
 * GET  /api/content/archived            — list archived articles
 * POST /api/content/archived            — { slug } restores one to the live site
 *
 * Behind the proxy's session gate.
 */
import { NextRequest, NextResponse } from "next/server";
import { listArchived, restoreArchived } from "@/lib/article-store";
import { ContentWriteError, canWriteFiles, isGitHubWriteConfigured } from "@/lib/content-writer";
import { resolveNiche } from "@/lib/niches";

export async function GET(req: NextRequest) {
  const niche = resolveNiche(req);
  const articles = listArchived(niche);
  return NextResponse.json({ articles, total: articles.length });
}

export async function POST(req: NextRequest) {
  if (!canWriteFiles() && !isGitHubWriteConfigured()) {
    return NextResponse.json(
      { error: "This deployment can't save changes: GITHUB_TOKEN isn't set." },
      { status: 501 }
    );
  }

  const niche = resolveNiche(req);
  let slug: string | undefined;
  try {
    ({ slug } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });

  try {
    const article = await restoreArchived(slug, niche);
    if (!article) return NextResponse.json({ error: `No archived article "${slug}"` }, { status: 404 });
    return NextResponse.json({ ok: true, article, pending: !canWriteFiles() });
  } catch (err) {
    const message = err instanceof ContentWriteError ? err.message : (err as Error).message;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
