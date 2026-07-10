/**
 * POST /api/content/chat-draft
 * Save an article written in the editorial chat as a real draft, so it drops
 * into the existing CREATE → review → publish pipeline.
 *
 * Body: {
 *   niche?: string,          // falls back to active niche
 *   title: string,           // headline
 *   markdown: string,        // article body (may start with an H1 we strip)
 *   pickId?: string,         // optional originating pick (for source refs)
 *   sources?: { source_id?, source_name?, title?, url? }[]
 * }
 *
 * Writes to the filesystem, so this only works where the FS is writable
 * (local / CI) — the deployed Vercel app is read-only and will 500 here, which
 * is expected: authoring happens locally, the deploy just serves readers.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveNiche } from "@/lib/niches";
import {
  saveDraft,
  slugify,
  generateId,
  type ArticleDraft,
  type SourceReference,
} from "@/lib/article-store";

// scrypt-free but writes FS — needs Node runtime.
export const runtime = "nodejs";

/** Strip a leading "# Headline" line so it isn't duplicated in the body. */
function stripLeadingH1(md: string): string {
  return md.replace(/^\s*#\s+.+?\n+/, "").trimStart();
}

/** Rough plaintext excerpt from markdown for SEO/preview. */
function excerptFrom(md: string, len = 160): string {
  const text = md
    .replace(/^#.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > len ? text.slice(0, len).trimEnd() + "…" : text;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { title, markdown, sources } = body as {
      title?: string;
      markdown?: string;
      sources?: Partial<SourceReference>[];
    };

    if (!title || !markdown) {
      return NextResponse.json({ error: "title and markdown are required" }, { status: 400 });
    }

    const niche = typeof body.niche === "string" && body.niche ? body.niche : resolveNiche(req);
    const bodyMarkdown = stripLeadingH1(markdown);
    const excerpt = excerptFrom(bodyMarkdown);

    const source_articles: SourceReference[] = Array.isArray(sources)
      ? sources
          .filter((s) => s && (s.url || s.title))
          .map((s) => ({
            source_id: s.source_id || "chat",
            source_name: s.source_name || "Editorial chat",
            title: s.title || title,
            url: s.url || "",
            excerpt: s.excerpt,
          }))
      : [];

    const draft: ArticleDraft = {
      id: generateId(),
      niche,
      created_at: new Date().toISOString(),
      status: "draft",
      source_articles,
      headline_options: [title],
      selected_headline: title,
      slug: slugify(title),
      body_markdown: bodyMarkdown,
      excerpt,
      seo: {
        meta_title: title,
        meta_description: excerpt,
        keywords: [],
      },
      generation: {
        model: "editorial-chat",
        prompt_tokens: 0,
        completion_tokens: 0,
        generation_time_ms: 0,
      },
    };

    saveDraft(draft, niche);

    return NextResponse.json({ ok: true, id: draft.id, slug: draft.slug, niche });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save draft: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
