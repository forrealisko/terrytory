/**
 * GET /admin/content/review/[id]/preview
 * Full-page "as published" preview of a draft, rendered through the real
 * magazine template (Fraunces + paper styling + sized images) so the editor
 * sees exactly how the article will look live — before shipping.
 *
 * Auth: lives under /admin, so the proxy already gates it.
 */
import type { CSSProperties } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Fraunces } from "next/font/google";
import { getDraft } from "@/lib/article-store";
import { bakeImageSlots } from "@/lib/image-slots";
import { renderMarkdown, nicheImageUrl, readTimeMin } from "@/lib/markdown";
import { isValidNiche, nicheBrand, formatDate } from "@/lib/site";
import { DEFAULT_NICHE } from "@/lib/niches";
import "@/styles/magazine.css";

export const dynamic = "force-dynamic";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap" });

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DraftPreview({ params }: PageProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const cookieNiche = cookieStore.get("niche")?.value;
  const niche = cookieNiche && isValidNiche(cookieNiche) ? cookieNiche : DEFAULT_NICHE;

  const draft = getDraft(id, niche);
  if (!draft) notFound();

  const brand = nicheBrand(niche);
  const headline =
    draft.selected_headline || draft.headline_options?.[0] || draft.seo?.meta_title || "Untitled";
  const heroImg = nicheImageUrl(draft.hero_image_url, niche);

  // Bake image-slot tokens into final markdown, then strip a leading H1 the
  // writer sometimes emits (so it isn't duplicated under the title).
  const baked = bakeImageSlots(draft.body_markdown || "", draft.visual_suggestions || []);
  const rawBody = baked.replace(/^\s*#\s+.+\n+/, "");
  const bodyHtml = renderMarkdown(rawBody, niche, draft.social_embeds);
  const liveEmbeds = draft.social_embeds?.filter((e) => e.live) || [];
  const needsTwitter = liveEmbeds.some((e) => e.platform === "x");
  const needsInstagram = liveEmbeds.some((e) => e.platform === "instagram");

  return (
    <div
      className={`mag ${display.variable}`}
      style={{ "--accent": brand.accent, position: "fixed", inset: 0, overflowY: "auto", zIndex: 9999, background: "#f4efe6" } as CSSProperties}
    >
      <div className="mag-grain" aria-hidden />

      {/* Preview banner — clearly not the live article */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 18px",
          background: "rgba(27, 26, 23, 0.92)",
          color: "#f4efe6",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          backdropFilter: "blur(6px)",
        }}
      >
        <span>
          👁 <strong>Preview</strong> — how this draft will look once published (not live yet)
        </span>
        <Link
          href={`/admin/content/review/${id}`}
          style={{
            color: "#f4efe6",
            textDecoration: "none",
            border: "1px solid rgba(244,239,230,0.35)",
            borderRadius: 10,
            padding: "6px 14px",
            fontWeight: 600,
          }}
        >
          ← Back to editor
        </Link>
      </div>

      <article className="mag-article">
        <div className="mag-container">
          <header className="mag-article-head">
            <span className="mag-kicker">{draft.seo?.keywords?.[0] || brand.shortName}</span>
            <h1 className="mag-article-title">{headline}</h1>
            {draft.excerpt && <p className="mag-article-standfirst">{draft.excerpt}</p>}
            <div className="mag-article-byline">
              <span>{draft.author ? `By ${draft.author.name}` : `${brand.name} Editorial`}</span>
              {draft.author?.title && (
                <>
                  <span className="dot" />
                  <span>{draft.author.title}</span>
                </>
              )}
              <span className="dot" />
              <time>{formatDate(draft.created_at)}</time>
              <span className="dot" />
              <span>{readTimeMin(draft.body_markdown || "")} min read</span>
            </div>
          </header>
        </div>

        {heroImg && (
          <div className="mag-container">
            <div className="mag-article-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={heroImg} alt={draft.hero_image_alt || headline} />
            </div>
          </div>
        )}

        <div className="mag-container">
          <div className="mag-article-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          {needsTwitter && <script async src="https://platform.twitter.com/widgets.js" charSet="utf-8" />}
          {needsInstagram && <script async src="https://www.instagram.com/embed.js" />}

          {draft.author && (
            <div className="mag-author-card">
              <div className="mag-author-avatar" aria-hidden>
                {draft.author.name.split(" ").filter(Boolean).slice(-2).map((w) => w[0]).join("")}
              </div>
              <div className="mag-author-meta">
                <span className="mag-author-name">{draft.author.name}</span>
                <span className="mag-author-title">{draft.author.title}, {brand.name}</span>
                <p className="mag-author-bio">{draft.author.bio}</p>
              </div>
            </div>
          )}

          {draft.source_articles && draft.source_articles.length > 0 && (
            <div className="mag-endmatter">
              <h3>Sources</h3>
              <ul>
                {draft.source_articles.map((src, i) => (
                  <li key={i}>
                    <a href={src.url} target="_blank" rel="noopener noreferrer">
                      {src.source_name}: {src.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
