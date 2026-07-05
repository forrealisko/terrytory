import Link from "next/link";
import { listPublished } from "@/lib/article-store";
import { getNiche, DEFAULT_NICHE, listNicheIds } from "@/lib/niches";

function wordCount(text: string): number {
  return text
    .replace(/[#*_\[\]()>`-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function BlogIndexPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const raw = typeof sp.niche === "string" ? sp.niche : DEFAULT_NICHE;
  const nicheId = listNicheIds().includes(raw) ? raw : DEFAULT_NICHE;
  const niche = getNiche(nicheId);

  const { articles } = listPublished(1, 50, nicheId);

  const heroTitle = niche.brand?.hero_title || niche.brand?.name || "TERRYTORY";
  const heroLines = heroTitle.split("\n");
  const heroSubtitle = niche.brand?.hero_subtitle || niche.brand?.tagline || "";

  return (
    <div className="blog-index">
      {/* Hero Section */}
      <section className="blog-hero">
        <h1 className="blog-hero-title">
          {heroLines.map((line, i) =>
            i === 0 ? (
              <span key={i}>{line}</span>
            ) : (
              <span key={i}>
                <br />
                <span className="blog-hero-accent">{line}</span>
              </span>
            )
          )}
        </h1>
        <p className="blog-hero-subtitle">{heroSubtitle}</p>
      </section>

      {/* Articles Grid */}
      {articles.length === 0 ? (
        <div className="blog-empty">
          <p>No articles published yet. Check back soon.</p>
        </div>
      ) : (
        <section className="blog-articles-grid">
          {articles.map((article) => {
            const words = wordCount(article.body_markdown);
            const readTime = Math.max(1, Math.ceil(words / 250));
            const headline =
              article.selected_headline ||
              article.headline_options?.[0] ||
              article.seo?.meta_title ||
              "Untitled";

            return (
              <Link
                key={article.id}
                href={`/blog/${article.slug}?niche=${nicheId}`}
                className="blog-article-card"
              >
                {article.hero_image_url && (
                  <div className="blog-card-image-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={article.hero_image_url}
                      alt={article.hero_image_alt || headline}
                      className="blog-card-image"
                    />
                  </div>
                )}
                <div className="blog-card-content">
                  <div className="blog-card-meta">
                    <time>{formatDate(article.published_at || article.created_at)}</time>
                    <span>·</span>
                    <span>{readTime} min read</span>
                  </div>
                  <h2 className="blog-card-title">{headline}</h2>
                  <p className="blog-card-excerpt">{article.excerpt}</p>
                  <div className="blog-card-keywords">
                    {article.seo?.keywords?.slice(0, 3).map((kw, i) => (
                      <span key={i} className="blog-card-keyword">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
