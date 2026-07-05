import Link from "next/link";
import { notFound } from "next/navigation";
import { listPublished } from "@/lib/article-store";
import { nicheImageUrl, readTimeMin } from "@/lib/markdown";
import { isValidNiche, magBasePath, nicheBrand, formatDate } from "@/lib/site";
import type { ArticleDraft } from "@/lib/article-store";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ niche: string }>;
}

function headlineOf(a: ArticleDraft): string {
  return a.selected_headline || a.headline_options?.[0] || a.seo?.meta_title || "Untitled";
}

function Card({
  a,
  niche,
  base,
  kicker,
  className = "",
  riseClass = "",
}: {
  a: ArticleDraft;
  niche: string;
  base: string;
  kicker: string;
  className?: string;
  riseClass?: string;
}) {
  const headline = headlineOf(a);
  const img = nicheImageUrl(a.hero_image_url, niche);
  return (
    <Link href={`${base}/${a.slug}`} className={`mag-card ${className} ${riseClass}`}>
      <div className={`mag-card-media ${img ? "" : "is-empty"}`}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={a.hero_image_alt || headline} loading="lazy" />
        ) : (
          <span>T</span>
        )}
      </div>
      <span className="mag-kicker">{a.seo?.keywords?.[0] || kicker}</span>
      <h3 className="mag-card-title">{headline}</h3>
      {a.excerpt && <p className="mag-card-excerpt">{a.excerpt}</p>}
      <div className="mag-meta">
        <time>{formatDate(a.published_at || a.created_at)}</time>
        <span className="dot" />
        <span>{readTimeMin(a.body_markdown)} min read</span>
      </div>
    </Link>
  );
}

export default async function MagazineHome({ params }: PageProps) {
  const { niche } = await params;
  if (!isValidNiche(niche)) notFound();

  const brand = nicheBrand(niche);
  const base = await magBasePath(niche);
  const { articles } = listPublished(1, 50, niche);

  const heroLines = brand.heroTitle.split("\n");
  const kicker = brand.shortName;

  const [feature, ...rest] = articles;

  return (
    <div className="mag-container">
      {/* Lede */}
      <section className="mag-lede rise rise-1">
        <span className="mag-eyebrow">{brand.name}</span>
        <h1 className="mag-lede-title">
          {heroLines.map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {i === 0 ? line : <span className="i">{line}</span>}
            </span>
          ))}
        </h1>
        <p className="mag-lede-sub">{brand.heroSubtitle}</p>
      </section>

      {articles.length === 0 ? (
        <div className="mag-empty">
          <div className="mag-empty-mark">Soon.</div>
          <p>The first stories are being written. Check back shortly.</p>
        </div>
      ) : (
        <>
          {/* Featured top story */}
          {feature && (
            <Link href={`${base}/${feature.slug}`} className="mag-feature rise rise-2">
              <div>
                <span className="mag-kicker">Top Story</span>
                <h2 className="mag-feature-title">{headlineOf(feature)}</h2>
                {feature.excerpt && <p className="mag-feature-excerpt">{feature.excerpt}</p>}
                <div className="mag-meta" style={{ marginTop: 18 }}>
                  <time>{formatDate(feature.published_at || feature.created_at)}</time>
                  <span className="dot" />
                  <span>{readTimeMin(feature.body_markdown)} min read</span>
                </div>
              </div>
              <div className="mag-feature-media">
                {nicheImageUrl(feature.hero_image_url, niche) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={nicheImageUrl(feature.hero_image_url, niche)!}
                    alt={feature.hero_image_alt || headlineOf(feature)}
                  />
                ) : (
                  <div className="mag-card-media is-empty" style={{ margin: 0, height: "100%" }}>
                    <span>T</span>
                  </div>
                )}
              </div>
            </Link>
          )}

          {/* Grid */}
          {rest.length > 0 && (
            <>
              <div className="mag-section-head">
                <span className="mag-section-title">Latest</span>
                <span className="mag-section-rule" />
              </div>
              <div className="mag-grid">
                {rest.map((a, i) => (
                  <Card
                    key={a.id}
                    a={a}
                    niche={niche}
                    base={base}
                    kicker={kicker}
                    riseClass={`rise rise-${Math.min(4, (i % 3) + 1)}`}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
