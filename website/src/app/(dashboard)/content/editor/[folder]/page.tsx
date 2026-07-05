"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import TiptapEditor, { TiptapRef } from "./TiptapEditor";

function wordCount(text: string): number {
  return text.replace(/<[^>]*>?/gm, "").split(/\s+/).filter((w) => w.length > 0).length;
}

// ─── Editor ──────────────────────────────────────────────────────────────────
export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const folder = params.folder as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Data
  const [articleMd, setArticleMd] = useState("");
  const [articleHtml, setArticleHtml] = useState("");
  const [headline, setHeadline] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [heroAlt, setHeroAlt] = useState("");
  const [model, setModel] = useState("");
  const [sourceArticles, setSourceArticles] = useState<
    Array<{ source_name: string; title: string; url: string }>
  >([]);
  const [images, setImages] = useState<string[]>([]);

  // UI
  const [panelOpen, setPanelOpen] = useState(false);
  const editorRef = useRef<TiptapRef>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load ──
  const fetchArticle = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/shipped/${folder}`);
      if (!res.ok) throw new Error("Article not found");
      const data = await res.json();

      const md = data.article_md || "";
      const html = data.article_html || "";
      const match = md.match(/^# (.+)\n\n/);
      if (match) {
        setHeadline(match[1]);
        setArticleMd(md.slice(match[0].length));
      } else {
        setHeadline(data.meta?.headline || "");
        setArticleMd(md);
      }
      setArticleHtml(html);

      setSlug(data.meta?.slug || "");
      setExcerpt(data.formatting?.excerpt || "");
      setMetaTitle(data.meta?.seo?.meta_title || "");
      setMetaDesc(data.meta?.seo?.meta_description || "");
      setKeywords(data.meta?.seo?.keywords || []);
      setHeroImageUrl(data.meta?.hero_image_url || "");
      setHeroAlt(data.meta?.hero_image_alt || "");
      setModel(data.meta?.generation?.model || "");
      setSourceArticles(data.meta?.source_articles || []);
      setImages(data.images || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => { fetchArticle(); }, [fetchArticle]);

  // ── Auto-save ──
  const doSave = useCallback(async (silent = true) => {
    try {
      const fullMd = `# ${headline}\n\n${articleMd}`;
      await fetch(`/api/content/shipped/${folder}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article_md: fullMd,
          article_html: articleHtml,
          meta: {
            headline, slug,
            seo: { meta_title: metaTitle, meta_description: metaDesc, keywords },
            hero_image_url: heroImageUrl, hero_image_alt: heroAlt,
          },
          formatting: { excerpt },
        }),
      });
      if (!silent) showToast("Saved ✓");
    } catch {
      if (!silent) showToast("Save failed ✗");
    }
  }, [folder, headline, articleMd, articleHtml, slug, metaTitle, metaDesc, keywords, heroImageUrl, heroAlt, excerpt]);

  useEffect(() => {
    if (loading) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => doSave(true), 2500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [articleMd, articleHtml, headline, doSave, loading]);

  // ── Publish ──
  const handlePublish = async () => {
    if (!confirm("Post this article to the live website?")) return;
    await doSave(false);
    setPublishing(true);
    try {
      const res = await fetch(`/api/content/shipped/${folder}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Live! → ${data.blog_url}`);
      setTimeout(() => router.push("/content/published"), 2000);
    } catch (err) {
      showToast(`Publish failed: ${(err as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  // ── Image upload ──
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`/api/content/shipped/${folder}/images`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImages((prev) => [...prev, data.filename]);
      showToast(`Uploaded: ${data.filename}`);
    } catch (err) {
      showToast(`Upload failed: ${(err as Error).message}`);
    }
  };

  const insertImage = (filename: string) => {
    const url = `/api/content/shipped/${folder}/images/${filename}`;
    editorRef.current?.insertImage(url);
    showToast("Image inserted ✓");
  };

  // ── Render ──
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", gap: 12, color: "var(--text-muted)" }}>
      <span className="loading-spinner" style={{ width: 20, height: 20 }} /> Loading...
    </div>
  );

  if (error) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}>
      <span style={{ color: "var(--accent-rose)" }}>❌ {error}</span>
      <button className="btn btn-secondary" onClick={() => router.push("/content/published")}>← Back</button>
    </div>
  );

  return (
    <div className="ed">
      {toast && <div className="ed-toast">{toast}</div>}

      {/* ═══ Top Bar ═══ */}
      <div className="ed-topbar">
        <button className="btn btn-secondary" onClick={() => router.push("/content/published")} style={{ padding: "6px 12px", fontSize: 12 }}>
          ← Back
        </button>
        <div className="ed-topbar-center">
          <span className="ed-badge">{folder}</span>
          <span className="ed-badge">{wordCount(articleMd).toLocaleString()} words</span>
          {model && <span className="ed-badge">{model.split("/").pop()}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setPanelOpen(!panelOpen)} style={{ padding: "6px 12px", fontSize: 12 }}>
            {panelOpen ? "Hide Panel" : "⚙ Settings"}
          </button>
          <button className="btn btn-secondary" onClick={() => doSave(false)} disabled={saving} style={{ fontSize: 12 }}>
            💾 Save
          </button>
          <button className="btn btn-primary" onClick={handlePublish} disabled={publishing} style={{ fontWeight: 700, fontSize: 13 }}>
            {publishing ? "Publishing..." : "🌐 Post to Website"}
          </button>
        </div>
      </div>

      {/* ═══ Workspace ═══ */}
      <div className="ed-body">
        {/* ── Main editor area ── */}
        <div className="ed-canvas">
          {/* Headline */}
          <input
            className="ed-headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Article headline..."
          />
          {/* Content */}
          <div className="ed-preview">
            <TiptapEditor
              ref={editorRef}
              initialContent={articleHtml || articleMd}
              isMarkdown={!articleHtml}
              onChange={(html) => {
                setArticleHtml(html);
                setArticleMd(""); // Clear markdown once we start editing rich text
              }}
            />
          </div>
        </div>

        {/* ── Side panel (toggled) ── */}
        {panelOpen && (
          <aside className="ed-panel">
            {/* SEO / Meta */}
            <div className="ed-section">
              <h4 className="ed-section-title">SEO & META</h4>

              <label className="ed-lbl">Slug</label>
              <input className="input-field ed-input" value={slug} onChange={(e) => setSlug(e.target.value)} />

              <label className="ed-lbl">Excerpt</label>
              <textarea className="input-field ed-input" value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} maxLength={200} />
              <span className="ed-hint" style={{ color: excerpt.length > 155 ? "var(--accent-rose)" : undefined }}>{excerpt.length}/155</span>

              <label className="ed-lbl">SEO Title</label>
              <input className="input-field ed-input" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />

              <label className="ed-lbl">Meta Description</label>
              <textarea className="input-field ed-input" value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} rows={2} />

              <label className="ed-lbl">Keywords</label>
              <div className="ed-tags">
                {keywords.map((kw, i) => (
                  <span key={i} className="ed-tag" onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}>{kw} ×</span>
                ))}
              </div>
              <input
                className="input-field ed-input"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newKeyword.trim()) { setKeywords([...keywords, newKeyword.trim()]); setNewKeyword(""); } }}
                placeholder="Add keyword + Enter"
              />
            </div>

            {/* Hero Image */}
            <div className="ed-section">
              <h4 className="ed-section-title">HERO IMAGE</h4>
              <label className="ed-lbl">URL</label>
              <input className="input-field ed-input" value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)} />
              {heroImageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={heroImageUrl} alt={heroAlt} style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 6, marginTop: 6, border: "1px solid var(--border-subtle)" }} />
              )}
              <label className="ed-lbl" style={{ marginTop: 8 }}>Alt Text</label>
              <input className="input-field ed-input" value={heroAlt} onChange={(e) => setHeroAlt(e.target.value)} />
            </div>

            {/* Images Gallery */}
            <div className="ed-section">
              <h4 className="ed-section-title">IMAGES</h4>
              <label className="ed-upload" htmlFor="ed-img-up">
                + Upload Image
                <input id="ed-img-up" type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
              </label>
              {images.length > 0 && (
                <div className="ed-img-grid">
                  {images.map((img) => (
                    <div key={img} className="ed-img-card" onClick={() => insertImage(img)} title="Click to insert">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/content/shipped/${folder}/images/${img}`} alt={img} />
                      <span>{img.length > 18 ? img.slice(0, 15) + "..." : img}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sources */}
            {sourceArticles.length > 0 && (
              <div className="ed-section">
                <h4 className="ed-section-title">SOURCES ({sourceArticles.length})</h4>
                {sourceArticles.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="ed-source">
                    <span className="ed-source-from">{s.source_name}</span>
                    <span className="ed-source-title">{s.title}</span>
                  </a>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
