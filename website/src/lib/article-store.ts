/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ARTICLE STORE — niche-aware                                 ║
 * ║  Filesystem-backed article lifecycle management.             ║
 * ║  States: draft → published | rejected                        ║
 * ║  Every function takes the niche id (defaults to "ufo").      ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DEFAULT_NICHE, ensureNicheDirs } from "./niches";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SourceReference {
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  excerpt?: string;
}

export interface ArticleSeo {
  meta_title: string;
  meta_description: string;
  keywords: string[];
  og_title?: string;
  og_description?: string;
}

export interface GenerationMeta {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  generation_time_ms: number;
}

export interface AffiliateSlot {
  after_paragraph: number;
  kind: string;
  query: string;
  context: string;
  url?: string;
  label?: string;
}

export interface Author {
  id: string;
  name: string;
  title: string;
  bio: string;
}

export interface ArticleDraft {
  id: string;
  niche?: string;
  created_at: string;
  status: "draft" | "published" | "rejected" | "generating";
  format?: string;
  author?: Author;

  source_articles: SourceReference[];

  headline_options: string[];
  selected_headline?: string;
  slug: string;
  body_markdown: string;
  body_html?: string;
  excerpt: string;

  seo: ArticleSeo;

  hero_image_url?: string;
  hero_image_alt?: string;
  hero_image_prompt?: string;

  affiliate_slots?: AffiliateSlot[];

  generation: GenerationMeta;

  published_at?: string;
  published_slug?: string;
  shipped_at?: string;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

function D(niche: string) {
  const p = ensureNicheDirs(niche);
  return {
    drafts: p.drafts,
    published: p.published,
    shipped: p.shipped,
    rejected: p.rejected,
    images: p.images,
    content: p.content,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readJsonFile<T>(filepath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filepath: string, data: unknown): void {
  const tmp = filepath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filepath);
}

function listJsonFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/** List all pending drafts, newest first */
export function listDrafts(niche: string = DEFAULT_NICHE): ArticleDraft[] {
  const drafts = listJsonFiles(D(niche).drafts)
    .map((f) => readJsonFile<ArticleDraft>(f))
    .filter((d): d is ArticleDraft => d !== null && (d.status === "draft" || d.status === "generating"));

  drafts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return drafts;
}

export function getDraft(id: string, niche: string = DEFAULT_NICHE): ArticleDraft | null {
  return readJsonFile<ArticleDraft>(path.join(D(niche).drafts, `${id}.json`));
}

export function saveDraft(draft: ArticleDraft, niche: string = DEFAULT_NICHE): void {
  writeJsonFile(path.join(D(niche).drafts, `${draft.id}.json`), draft);
}

export function updateDraft(
  id: string,
  updates: Partial<ArticleDraft>,
  niche: string = DEFAULT_NICHE
): ArticleDraft | null {
  const draft = getDraft(id, niche);
  if (!draft) return null;
  const updated = { ...draft, ...updates, id };
  saveDraft(updated, niche);
  return updated;
}

/** Publish a draft — moves it to the published directory */
export function publishDraft(
  id: string,
  overrides?: {
    selected_headline?: string;
    body_markdown?: string;
    slug?: string;
    seo?: Partial<ArticleSeo>;
    hero_image_url?: string;
    hero_image_alt?: string;
  },
  niche: string = DEFAULT_NICHE
): ArticleDraft | null {
  const draft = getDraft(id, niche);
  if (!draft) return null;

  const now = new Date().toISOString();
  const finalSlug = overrides?.slug || draft.slug;
  const publishedSlug = `${now.slice(0, 10)}_${finalSlug}`;

  const published: ArticleDraft = {
    ...draft,
    status: "published",
    niche,
    selected_headline:
      overrides?.selected_headline || draft.selected_headline || draft.headline_options[0],
    body_markdown: overrides?.body_markdown || draft.body_markdown,
    slug: finalSlug,
    published_at: now,
    published_slug: publishedSlug,
    seo: { ...draft.seo, ...overrides?.seo },
    hero_image_url: overrides?.hero_image_url || draft.hero_image_url,
    hero_image_alt: overrides?.hero_image_alt || draft.hero_image_alt,
  };

  writeJsonFile(path.join(D(niche).published, `${publishedSlug}.json`), published);
  try {
    fs.unlinkSync(path.join(D(niche).drafts, `${id}.json`));
  } catch {}
  return published;
}

/**
 * Ship a draft — packages it into a self-contained folder.
 * The draft is kept intact (not deleted) so it stays in the Create queue.
 */
export function shipDraft(
  id: string,
  overrides?: {
    selected_headline?: string;
    body_markdown?: string;
    slug?: string;
    seo?: Partial<ArticleSeo>;
    hero_image_url?: string;
    hero_image_alt?: string;
    hero_image_prompt?: string;
  },
  niche: string = DEFAULT_NICHE
): { folderName: string; folderPath: string } | null {
  const draft = getDraft(id, niche);
  if (!draft) return null;
  const dirs = D(niche);

  const now = new Date().toISOString();
  const finalSlug = overrides?.slug || draft.slug;
  const folderName = `${now.slice(0, 10)}_${finalSlug}`;
  const folderPath = path.join(dirs.shipped, folderName);

  fs.mkdirSync(path.join(folderPath, "images"), { recursive: true });

  const finalHeadline =
    overrides?.selected_headline || draft.selected_headline || draft.headline_options[0];
  const finalBody = overrides?.body_markdown || draft.body_markdown;
  const finalSeo = { ...draft.seo, ...overrides?.seo };
  const finalHeroUrl = overrides?.hero_image_url || draft.hero_image_url;
  const finalHeroAlt = overrides?.hero_image_alt || draft.hero_image_alt;
  const finalHeroPrompt = overrides?.hero_image_prompt || draft.hero_image_prompt;

  fs.writeFileSync(path.join(folderPath, "article.md"), `# ${finalHeadline}\n\n${finalBody}`, "utf-8");

  writeJsonFile(path.join(folderPath, "meta.json"), {
    id: draft.id,
    niche,
    headline: finalHeadline,
    slug: finalSlug,
    folder_name: folderName,
    created_at: draft.created_at,
    shipped_at: now,
    seo: finalSeo,
    hero_image_url: finalHeroUrl,
    hero_image_alt: finalHeroAlt,
    hero_image_prompt: finalHeroPrompt,
    generation: draft.generation,
    source_articles: draft.source_articles,
  });

  writeJsonFile(path.join(folderPath, "formatting.json"), {
    headline_options: draft.headline_options,
    selected_headline: finalHeadline,
    excerpt: draft.excerpt,
    hero_image_prompt: finalHeroPrompt,
  });

  // Copy images that belong to this draft
  try {
    for (const imgFile of fs.readdirSync(dirs.images)) {
      if (imgFile.includes(id) || imgFile.includes(finalSlug)) {
        fs.copyFileSync(path.join(dirs.images, imgFile), path.join(folderPath, "images", imgFile));
      }
    }
    if (finalHeroUrl && !finalHeroUrl.startsWith("http")) {
      const heroFileName = path.basename(finalHeroUrl);
      const heroSrc = path.join(dirs.images, heroFileName);
      if (fs.existsSync(heroSrc)) {
        fs.copyFileSync(heroSrc, path.join(folderPath, "images", heroFileName));
      }
    }
  } catch {}

  updateDraft(id, { shipped_at: now }, niche);
  return { folderName, folderPath };
}

/** List all shipped article folders, newest first */
export function listShipped(niche: string = DEFAULT_NICHE): Array<{
  folder_name: string;
  headline: string;
  slug: string;
  shipped_at: string;
  created_at: string;
  generation: GenerationMeta;
  source_articles: SourceReference[];
  seo: ArticleSeo;
  hero_image_url?: string;
}> {
  try {
    const dirs = D(niche);
    const results = fs
      .readdirSync(dirs.shipped, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((folder) => {
        const meta = readJsonFile<Record<string, unknown>>(
          path.join(dirs.shipped, folder.name, "meta.json")
        );
        if (!meta) return null;
        return { ...meta, folder_name: folder.name };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null) as ReturnType<typeof listShipped>;

    results.sort(
      (a, b) =>
        new Date(b.shipped_at || b.created_at).getTime() -
        new Date(a.shipped_at || a.created_at).getTime()
    );
    return results;
  } catch {
    return [];
  }
}

/** Read a single shipped article folder */
export function getShippedArticle(
  folderName: string,
  niche: string = DEFAULT_NICHE
): {
  article_md: string;
  article_html: string;
  meta: Record<string, unknown>;
  formatting: Record<string, unknown>;
  images: string[];
} | null {
  const folderPath = path.join(D(niche).shipped, folderName);
  if (!fs.existsSync(folderPath)) return null;

  const article_md = fs.existsSync(path.join(folderPath, "article.md"))
    ? fs.readFileSync(path.join(folderPath, "article.md"), "utf-8")
    : "";
  const article_html = fs.existsSync(path.join(folderPath, "article.html"))
    ? fs.readFileSync(path.join(folderPath, "article.html"), "utf-8")
    : "";
  const meta = readJsonFile<Record<string, unknown>>(path.join(folderPath, "meta.json")) || {};
  const formatting = readJsonFile<Record<string, unknown>>(path.join(folderPath, "formatting.json")) || {};

  let images: string[] = [];
  try {
    images = fs
      .readdirSync(path.join(folderPath, "images"))
      .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f));
  } catch {}

  return { article_md, article_html, meta, formatting, images };
}

/** Update a shipped article folder (markdown, html, meta, formatting) */
export function updateShippedArticle(
  folderName: string,
  updates: {
    article_md?: string;
    article_html?: string;
    meta?: Record<string, unknown>;
    formatting?: Record<string, unknown>;
  },
  niche: string = DEFAULT_NICHE
): boolean {
  const folderPath = path.join(D(niche).shipped, folderName);
  if (!fs.existsSync(folderPath)) return false;

  if (updates.article_md !== undefined) {
    fs.writeFileSync(path.join(folderPath, "article.md"), updates.article_md, "utf-8");
  }
  if (updates.article_html !== undefined) {
    fs.writeFileSync(path.join(folderPath, "article.html"), updates.article_html, "utf-8");
  }
  if (updates.meta) {
    const existing = readJsonFile<Record<string, unknown>>(path.join(folderPath, "meta.json")) || {};
    writeJsonFile(path.join(folderPath, "meta.json"), { ...existing, ...updates.meta });
  }
  if (updates.formatting) {
    const existing =
      readJsonFile<Record<string, unknown>>(path.join(folderPath, "formatting.json")) || {};
    writeJsonFile(path.join(folderPath, "formatting.json"), { ...existing, ...updates.formatting });
  }
  return true;
}

/** Get the images directory for a shipped article */
export function getShippedImagesDir(folderName: string, niche: string = DEFAULT_NICHE): string {
  const dir = path.join(D(niche).shipped, folderName, "images");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Publish a shipped article — reads the shipped folder and creates
 * a published .json file that the blog can serve.
 */
export function publishShippedArticle(
  folderName: string,
  niche: string = DEFAULT_NICHE
): ArticleDraft | null {
  const data = getShippedArticle(folderName, niche);
  if (!data) return null;

  const meta = data.meta as Record<string, any>;
  const formatting = data.formatting as Record<string, any>;

  let bodyMarkdown = data.article_md;
  const headlineMatch = bodyMarkdown.match(/^# (.+)\n\n/);
  if (headlineMatch) bodyMarkdown = bodyMarkdown.slice(headlineMatch[0].length);

  const now = new Date().toISOString();
  const slug = (meta.slug as string) || folderName.replace(/^\d{4}-\d{2}-\d{2}_/, "");
  const publishedSlug = `${now.slice(0, 10)}_${slug}`;

  const published: ArticleDraft = {
    id: (meta.id as string) || generateId(),
    niche,
    created_at: (meta.created_at as string) || now,
    status: "published",
    source_articles: (meta.source_articles as SourceReference[]) || [],
    headline_options: (formatting.headline_options as string[]) || [],
    selected_headline: (meta.headline as string) || "",
    slug,
    body_markdown: bodyMarkdown,
    body_html: data.article_html || "",
    excerpt: (formatting.excerpt as string) || "",
    seo: (meta.seo as ArticleSeo) || { meta_title: "", meta_description: "", keywords: [] },
    hero_image_url: meta.hero_image_url as string | undefined,
    hero_image_alt: meta.hero_image_alt as string | undefined,
    hero_image_prompt: meta.hero_image_prompt as string | undefined,
    generation: (meta.generation as GenerationMeta) || {
      model: "unknown",
      prompt_tokens: 0,
      completion_tokens: 0,
      generation_time_ms: 0,
    },
    published_at: now,
    published_slug: publishedSlug,
  };

  writeJsonFile(path.join(D(niche).published, `${publishedSlug}.json`), published);
  return published;
}

/** Reject a draft — moves it to the rejected directory */
export function rejectDraft(id: string, niche: string = DEFAULT_NICHE): boolean {
  const draft = getDraft(id, niche);
  if (!draft) return false;

  writeJsonFile(path.join(D(niche).rejected, `${id}.json`), { ...draft, status: "rejected" as const });
  try {
    fs.unlinkSync(path.join(D(niche).drafts, `${id}.json`));
  } catch {}
  return true;
}

/** List published articles, newest first, with optional pagination */
export function listPublished(
  page = 1,
  limit = 20,
  niche: string = DEFAULT_NICHE
): { articles: ArticleDraft[]; total: number } {
  const articles = listJsonFiles(D(niche).published)
    .map((f) => readJsonFile<ArticleDraft>(f))
    .filter((a): a is ArticleDraft => a !== null);

  articles.sort(
    (a, b) =>
      new Date(b.published_at || b.created_at).getTime() -
      new Date(a.published_at || a.created_at).getTime()
  );

  const total = articles.length;
  const start = (page - 1) * limit;
  return { articles: articles.slice(start, start + limit), total };
}

/** Get a single published article by its slug */
export function getPublishedBySlug(slug: string, niche: string = DEFAULT_NICHE): ArticleDraft | null {
  for (const filepath of listJsonFiles(D(niche).published)) {
    const article = readJsonFile<ArticleDraft>(filepath);
    if (article && (article.published_slug === slug || article.slug === slug)) {
      return article;
    }
  }
  return null;
}

/** Get the images directory path */
export function getImagesDir(niche: string = DEFAULT_NICHE): string {
  return D(niche).images;
}

/** Get content base path for a niche (for external scripts) */
export function getContentBase2(niche: string = DEFAULT_NICHE): string {
  return D(niche).content;
}
