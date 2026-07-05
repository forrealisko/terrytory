import { notFound } from "next/navigation";
import { getPublishedBySlug, listPublished } from "@/lib/article-store";
import { getNiche, DEFAULT_NICHE, listNicheIds } from "@/lib/niches";
import type { Metadata } from "next";
import Link from "next/link";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const dynamic = "force-dynamic";

function resolveNicheId(raw: string | string[] | undefined): string {
  const v = typeof raw === "string" ? raw : DEFAULT_NICHE;
  return listNicheIds().includes(v) ? v : DEFAULT_NICHE;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const nicheId = resolveNicheId((await searchParams).niche);
  const article = getPublishedBySlug(slug, nicheId);

  if (!article) return { title: "Article Not Found — TERRYTORY" };

  const headline =
    article.selected_headline ||
    article.headline_options?.[0] ||
    article.seo?.meta_title ||
    "Untitled";

  return {
    title: article.seo?.meta_title || headline,
    description: article.seo?.meta_description || article.excerpt,
    keywords: article.seo?.keywords?.join(", "),
    openGraph: {
      title: article.seo?.og_title || headline,
      description: article.seo?.og_description || article.excerpt,
      type: "article",
      publishedTime: article.published_at,
      images: article.hero_image_url
        ? [{ url: article.hero_image_url }]
        : undefined,
    },
  };
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<div class="blog-body-image-container"><img src="$2" alt="$1" class="blog-body-image" /><span class="blog-body-image-caption">$1</span></div>'
  );

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');

  html = html.replace(
    /```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/g,
    '<pre><code>$1</code></pre>'
  );
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  const parts = html.split(
    /(<pre[\s\S]*?<\/pre>|<h[1-3][\s\S]*?<\/h[1-3]>|<ul>[\s\S]*?<\/ul>|<div[\s\S]*?<\/div>)/
  );
  for (let i = 0; i < parts.length; i++) {
    if (
      !parts[i].startsWith("<pre") &&
      !parts[i].startsWith("<h") &&
      !parts[i].startsWith("<ul") &&
      !parts[i].startsWith("<div")
    ) {
      parts[i] = parts[i]
        .split(/\n\n+/)
        .map((p) => (p.trim() ? `<p>${p.replace(/\n/g, "<br/>")}</p>` : ""))
        .join("");
    }
  }
  return parts.join("");
}

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

export default async function BlogArticlePage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const nicheId = resolveNicheId((await searchParams).niche);
  const brand = getNiche(nicheId).brand?.name || "TERRYTORY";
  const article = getPublishedBySlug(slug, nicheId);

  if (!article) notFound();

  const headline =
    article.selected_headline ||
    article.headline_options?.[0] ||
    article.seo?.meta_title ||
    "Untitled";

  const words = wordCount(article.body_markdown);
  const readTime = Math.max(1, Math.ceil(words / 250));

  // Get related articles (latest 3 excluding current)
  const { articles: allPublished } = listPublished(1, 10, nicheId);
  const related = allPublished
    .filter((a) => a.slug !== slug)
    .slice(0, 3);

  return (
    <article className="blog-article">
      {/* Hero Image */}
      {article.hero_image_url && (
        <div className="blog-article-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.hero_image_url}
            alt={article.hero_image_alt || headline}
            className="blog-article-hero-img"
          />
        </div>
      )}

      {/* Article Header */}
      <header className="blog-article-header">
        <h1 className="blog-article-title">{headline}</h1>
        <div className="blog-article-meta">
          <span>{brand} Editorial</span>
          <span>·</span>
          <time>{formatDate(article.published_at || article.created_at)}</time>
          <span>·</span>
          <span>{readTime} min read</span>
        </div>
        {article.seo?.keywords && article.seo.keywords.length > 0 && (
          <div className="blog-article-tags">
            {article.seo.keywords.map((kw, i) => (
              <span key={i} className="blog-card-keyword">
                {kw}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Article Body */}
      <div
        className="blog-article-body tiptap-content"
        dangerouslySetInnerHTML={{
          __html: article.body_html || renderMarkdown(article.body_markdown),
        }}
      />

      {/* Source Attribution */}
      {article.source_articles && article.source_articles.length > 0 && (
        <footer className="blog-article-sources">
          <h3>Sources</h3>
          <p>Based on reporting from:</p>
          <ul>
            {article.source_articles.map((src, i) => (
              <li key={i}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {src.source_name}: {src.title}
                </a>
              </li>
            ))}
          </ul>
        </footer>
      )}

      {/* Related Articles */}
      {related.length > 0 && (
        <section className="blog-related">
          <h3>More from {brand}</h3>
          <div className="blog-related-grid">
            {related.map((r) => {
              const rHeadline =
                r.selected_headline ||
                r.headline_options?.[0] ||
                "Untitled";
              return (
                <Link
                  key={r.id}
                  href={`/blog/${r.slug}?niche=${nicheId}`}
                  className="blog-related-card"
                >
                  <span className="blog-related-date">
                    {formatDate(r.published_at || r.created_at)}
                  </span>
                  <span className="blog-related-title">{rHeadline}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </article>
  );
}
