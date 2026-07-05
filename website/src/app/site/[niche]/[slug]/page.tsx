import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedBySlug, listPublished } from "@/lib/article-store";
import { renderMarkdown, nicheImageUrl, readTimeMin } from "@/lib/markdown";
import { isValidNiche, magBasePath, nicheBrand, formatDate } from "@/lib/site";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  if (!isValidNiche(niche)) return { title: "TERRYTORY" };
  const article = getPublishedBySlug(slug, niche);
  if (!article) return { title: "Not found" };
  const headline = article.selected_headline || article.headline_options?.[0] || "Untitled";
  const img = nicheImageUrl(article.hero_image_url, niche);
  return {
    title: article.seo?.meta_title || headline,
    description: article.seo?.meta_description || article.excerpt,
    keywords: article.seo?.keywords?.join(", "),
    openGraph: {
      title: article.seo?.og_title || headline,
      description: article.seo?.og_description || article.excerpt,
      type: "article",
      publishedTime: article.published_at,
      images: img ? [{ url: img }] : undefined,
    },
  };
}

export default async function MagazineArticle({ params }: PageProps) {
  const { niche, slug } = await params;
  if (!isValidNiche(niche)) notFound();

  const brand = nicheBrand(niche);
  const base = await magBasePath(niche);
  const article = getPublishedBySlug(slug, niche);
  if (!article) notFound();

  const headline = article.selected_headline || article.headline_options?.[0] || article.seo?.meta_title || "Untitled";
  const heroImg = nicheImageUrl(article.hero_image_url, niche);
  // The writer sometimes prefixes the body with the headline as an H1 — strip it
  // so it isn't duplicated under the title.
  const rawBody = article.body_markdown.replace(/^\s*#\s+.+\n+/, "");
  const bodyHtml = article.body_html
    ? article.body_html
    : renderMarkdown(rawBody, niche);

  const { articles } = listPublished(1, 8, niche);
  const related = articles.filter((a) => a.slug !== slug).slice(0, 3);

  return (
    <article className="mag-article">
      <div className="mag-container">
        <header className="mag-article-head rise rise-1">
          <span className="mag-kicker">{article.seo?.keywords?.[0] || brand.shortName}</span>
          <h1 className="mag-article-title">{headline}</h1>
          {article.excerpt && <p className="mag-article-standfirst">{article.excerpt}</p>}
          <div className="mag-article-byline">
            <span>{brand.name} Editorial</span>
            <span className="dot" />
            <time>{formatDate(article.published_at || article.created_at)}</time>
            <span className="dot" />
            <span>{readTimeMin(article.body_markdown)} min read</span>
          </div>
        </header>
      </div>

      {heroImg && (
        <div className="mag-container">
          <div className="mag-article-hero rise rise-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImg} alt={article.hero_image_alt || headline} />
          </div>
        </div>
      )}

      <div className="mag-container">
        <div
          className="mag-article-body"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        {article.source_articles && article.source_articles.length > 0 && (
          <div className="mag-endmatter">
            <h3>Sources</h3>
            <ul>
              {article.source_articles.map((src, i) => (
                <li key={i}>
                  <a href={src.url} target="_blank" rel="noopener noreferrer">
                    {src.source_name}: {src.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {related.length > 0 && (
          <div className="mag-endmatter">
            <h3>More from {brand.name}</h3>
            <div className="mag-grid" style={{ marginTop: 20, paddingBottom: 0 }}>
              {related.map((r) => {
                const rh = r.selected_headline || r.headline_options?.[0] || "Untitled";
                const rimg = nicheImageUrl(r.hero_image_url, niche);
                return (
                  <Link key={r.id} href={`${base}/${r.slug}`} className="mag-card">
                    <div className={`mag-card-media ${rimg ? "" : "is-empty"}`}>
                      {rimg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={rimg} alt={rh} loading="lazy" />
                      ) : (
                        <span>T</span>
                      )}
                    </div>
                    <h3 className="mag-card-title" style={{ fontSize: "1.1rem" }}>{rh}</h3>
                    <div className="mag-meta">
                      <time>{formatDate(r.published_at || r.created_at)}</time>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
