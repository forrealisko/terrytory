"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import type { VisualSuggestion, ImageSize } from "@/lib/article-store";
import { bakeImageSlots } from "@/lib/image-slots";

interface Draft {
  id: string;
  created_at: string;
  status: string;
  source_articles: Array<{
    source_id: string;
    source_name: string;
    title: string;
    url: string;
    excerpt?: string;
  }>;
  headline_options: string[];
  selected_headline?: string;
  slug: string;
  body_markdown: string;
  excerpt: string;
  seo: {
    meta_title: string;
    meta_description: string;
    keywords: string[];
  };
  hero_image_url?: string;
  hero_image_alt?: string;
  hero_image_prompt?: string;
  visual_suggestions?: VisualSuggestion[];
  generation: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    generation_time_ms: number;
  };
}

// AI image models offered per slot (keys must match generate-variations route).
const GEN_MODELS = [
  { key: "flux-dev", label: "Flux Dev", hint: "balanced" },
  { key: "flux-schnell", label: "Flux Schnell", hint: "fastest" },
  { key: "flux-pro", label: "Flux 1.1 Pro", hint: "best quality" },
] as const;

const SIZE_PRESETS: { key: ImageSize; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "full", label: "Full" },
];

// Split body_markdown into block units (paragraphs, headings, lists, tables,
// fenced code, and image-slot tokens) so the Preview can render slots as
// interactive cards and support drag-to-reposition between blocks. Blank lines
// separate blocks; fenced ``` regions are kept intact.
function splitBlocks(md: string): string[] {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  const flush = () => {
    if (cur.join("\n").trim()) blocks.push(cur.join("\n").trim());
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      cur.push(line);
      continue;
    }
    if (!inFence && line.trim() === "") flush();
    else cur.push(line);
  }
  flush();
  return blocks;
}

const SLOT_BLOCK_RE = /^\[IMAGE #(IMG\d+):\s*([^\]]*)\]$/;
function slotTokenOf(block: string): { id: string; desc: string } | null {
  const m = block.trim().match(SLOT_BLOCK_RE);
  return m ? { id: m[1], desc: m[2].trim() } : null;
}

// Move the block at `from` to gap position `to` (0..len) and rejoin.
function moveBlockInBody(body: string, from: number, to: number): string {
  const blocks = splitBlocks(body);
  if (from < 0 || from >= blocks.length) return body;
  const [moved] = blocks.splice(from, 1);
  const insertAt = to > from ? to - 1 : to;
  blocks.splice(Math.max(0, Math.min(insertAt, blocks.length)), 0, moved);
  return blocks.join("\n\n");
}

function renderMarkdown(text: string): string {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Editor image-brief placeholder tokens: [IMAGE #IMG2: description]
  // Rendered as an interactive slot; the review page delegates clicks by data-img-id.
  html = html.replace(
    /\[IMAGE #(IMG\d+):\s*([^\]]*)\]/g,
    (_m, id, desc) =>
      `<div class="img-slot" data-img-id="${id}"><span class="img-slot-label">🖼 ${id}</span><span class="img-slot-desc">${desc.trim()}</span><button type="button" class="img-slot-btn" data-img-id="${id}">Upload image</button></div>`
  );

  // Images
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<div class="blog-body-image-container"><img src="$2" alt="$1" class="blog-body-image" /><span class="blog-body-image-caption">$1</span></div>'
  );

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Code blocks
  html = html.replace(
    /```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/g,
    '<pre class="code-block"><code>$1</code></pre>'
  );
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold & italic
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Bullet points
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Paragraphs
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<h[1-3][\s\S]*?<\/h[1-3]>|<ul>[\s\S]*?<\/ul>|<div[\s\S]*?<\/div>)/);
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

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const draftId = params.id as string;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Editable state
  const [selectedHeadline, setSelectedHeadline] = useState<string>("");
  const [customHeadline, setCustomHeadline] = useState("");
  const [editingHeadline, setEditingHeadline] = useState(false);
  const [headlineDraft, setHeadlineDraft] = useState("");
  const [body, setBody] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [slug, setSlug] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [heroAlt, setHeroAlt] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [heroImagePrompt, setHeroImagePrompt] = useState("");
  const [imageGenerating, setImageGenerating] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);
  const [falConnected, setFalConnected] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Which image-brief slot (if any) triggered the file picker, so onChange can
  // route the file to the right inline token. null = legacy "insert at cursor".
  const pendingImgRef = useRef<{ id: string; description: string } | null>(null);

  // ── Image-brief slots: metadata (gallery, selection, size) lives in
  // visual_suggestions; the body keeps [IMAGE #IMGn] tokens as position anchors
  // and is baked into final markdown only at ship time. ──
  const [slots, setSlots] = useState<VisualSuggestion[]>([]);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [genModel, setGenModel] = useState<string>("flux-dev");
  const [generatingSlot, setGeneratingSlot] = useState<string | null>(null);
  // Drag-to-reposition state (Preview): index of the block being dragged and
  // the gap currently hovered.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overGap, setOverGap] = useState<number | null>(null);

  const slotById = (id?: string) => slots.find((s) => s.id === id);

  // Persist slot metadata to the draft (partial PUT — merges over other fields).
  const persistSlots = (next: VisualSuggestion[]) => {
    fetch(`/api/content/drafts/${draftId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visual_suggestions: next }),
    }).catch(() => {});
  };

  const mutateSlot = (id: string, patch: Partial<VisualSuggestion>) => {
    setSlots((prev) => {
      const exists = prev.some((s) => s.id === id);
      const next = exists
        ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
        : [...prev, { id, kind: "photo", description: "", size: "full" as ImageSize, ...patch }];
      persistSlots(next);
      return next;
    });
  };

  // Trigger the (single, hidden) file picker for a specific image-brief slot.
  const pickImageForSlot = (id: string, description: string) => {
    pendingImgRef.current = { id, description };
    imageInputRef.current?.click();
  };

  const selectVariation = (id: string, url: string) => mutateSlot(id, { selected_url: url });
  const removeSlotImage = (id: string) => mutateSlot(id, { selected_url: undefined });
  const setSlotSize = (id: string, size: ImageSize) => mutateSlot(id, { size });
  const updateSlotPrompt = (id: string, description: string) => mutateSlot(id, { description });

  // Generate AI variations for one slot; append to its gallery, auto-select if empty.
  async function generateForSlot(v: VisualSuggestion) {
    if (!v.id) return;
    setGeneratingSlot(v.id);
    try {
      const res = await fetch("/api/content/generate-variations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: v.description, articleId: draftId, slotId: v.id, model: genModel, count: 3 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      const urls: string[] = (data.images || []).map((im: { url: string }) => im.url);
      setSlots((prev) => {
        const exists = prev.some((s) => s.id === v.id);
        const next = exists
          ? prev.map((s) => {
              if (s.id !== v.id) return s;
              const gallery = [...(s.generated_urls || []), ...urls];
              return { ...s, generated_urls: gallery, selected_url: s.selected_url || urls[0] };
            })
          : [...prev, { id: v.id!, kind: v.kind || "photo", description: v.description, size: "full" as ImageSize, generated_urls: urls, selected_url: urls[0] }];
        persistSlots(next);
        return next;
      });
      showToast(`Generated ${urls.length} option${urls.length === 1 ? "" : "s"} for ${v.id} ✓`);
    } catch (err) {
      showToast(`Generation failed: ${(err as Error).message}`);
    } finally {
      setGeneratingSlot(null);
    }
  }

  // Upload a real image (logo/screenshot/diagram). If it targets a specific
  // image-brief slot, replace that inline [IMAGE #IMGn: …] token with the image.
  // Otherwise fall back to inserting markdown at the textarea cursor.
  async function handleImageUpload(file: File, target: { id: string; description: string } | null) {
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("articleId", draftId);
      const res = await fetch("/api/content/upload-image", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      if (target?.id) {
        // Targeted slot: add to its gallery and select it (token stays as anchor).
        const s = slotById(target.id);
        const gallery = [...(s?.generated_urls || []), data.url];
        mutateSlot(target.id, { generated_urls: gallery, selected_url: data.url });
        setToast(`Image placed in slot ${target.id}`);
      } else {
        // Legacy: insert at cursor (opens the editor first if in preview).
        const caption = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " ");
        const snippet = `\n\n![${caption}](${data.url})\n\n`;
        setShowEditor(true);
        const ta = bodyRef.current;
        if (ta && typeof ta.selectionStart === "number") {
          const pos = ta.selectionStart;
          setBody((b) => b.slice(0, pos) + snippet + b.slice(pos));
        } else {
          setBody((b) => b + snippet);
        }
        setToast("Image inserted — adjust the caption in the markdown");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  // Inline interactive image slot rendered in Preview at the token's position.
  // Not a component (avoids remount/focus loss) — a plain JSX-returning helper.
  const renderSlotCard = (slot: VisualSuggestion, blockIndex: number) => {
    const id = slot.id!;
    const url = slot.selected_url;
    const size = slot.size || "full";
    const gallery = slot.generated_urls || [];
    const isOpen = expandedSlot === id;
    const isGen = generatingSlot === id;
    const dragging = dragIdx === blockIndex;
    return (
      <div
        key={id}
        className={`imgslot ${url ? "imgslot--filled" : "imgslot--empty"} ${dragging ? "imgslot--dragging" : ""}`}
        draggable
        onDragStart={(e) => {
          setDragIdx(blockIndex);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDragIdx(null);
          setOverGap(null);
        }}
      >
        {url ? (
          <figure className={`imgslot-figure imgslot-figure--${size}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={slot.description} />
          </figure>
        ) : (
          <div className="imgslot-empty-brief">
            <span className="imgslot-label">🖼 {id}</span>
            <span className="imgslot-desc">{slot.description || slot.placement || "Image slot"}</span>
          </div>
        )}

        <div className="imgslot-toolbar">
          <span className="imgslot-badge" title="Drag to reposition in the article">⠿ 🖼 {id}{url ? "" : " · empty"}</span>
          <div className="imgslot-actions">
            <button className="btn btn-secondary vc-gen-btn imgslot-mini" disabled={isGen} onClick={() => generateForSlot(slot)}>
              {isGen ? "✨ Generating…" : gallery.length ? "✨ Regenerate" : "✨ Generate"}
            </button>
            <button className="btn btn-secondary imgslot-mini" disabled={uploadingImage} onClick={() => pickImageForSlot(id, slot.description)}>⬆ Upload</button>
            <button className="btn btn-secondary imgslot-mini" onClick={() => setExpandedSlot(isOpen ? null : id)}>{isOpen ? "▲ Close" : "⚙ Edit"}</button>
          </div>
        </div>

        {isOpen && (
          <div className="imgslot-panel">
            <label className="imgslot-field-label">Image prompt</label>
            <textarea
              className="input-field"
              rows={2}
              value={slot.description}
              onChange={(e) => updateSlotPrompt(id, e.target.value)}
              style={{ fontSize: 12, fontFamily: "var(--font-sans)", resize: "vertical" }}
            />

            <div className="imgslot-row">
              <div className="imgslot-chips">
                {GEN_MODELS.map((m) => (
                  <button key={m.key} type="button" className={`imgslot-chip ${genModel === m.key ? "active" : ""}`} onClick={() => setGenModel(m.key)} title={m.hint}>
                    {m.label}
                  </button>
                ))}
              </div>
              <button className="btn btn-secondary vc-gen-btn imgslot-mini" disabled={isGen} onClick={() => generateForSlot(slot)}>
                {isGen ? "✨ Generating…" : "✨ Generate 3"}
              </button>
            </div>

            {gallery.length > 0 && (
              <>
                <label className="imgslot-field-label">Variations — click to place</label>
                <div className="imgslot-gallery">
                  {gallery.map((g, gi) => (
                    <button key={gi} type="button" className={`vc-variation ${url === g ? "selected" : ""}`} onClick={() => selectVariation(id, g)} title={url === g ? "Placed" : "Use this one"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g} alt={`Variation ${gi + 1}`} />
                    </button>
                  ))}
                </div>
              </>
            )}

            {url && (
              <div className="imgslot-row" style={{ marginTop: 10 }}>
                <div className="imgslot-chips">
                  <span className="imgslot-field-label" style={{ margin: "0 4px 0 0" }}>Size</span>
                  {SIZE_PRESETS.map((s) => (
                    <button key={s.key} type="button" className={`imgslot-chip ${size === s.key ? "active" : ""}`} onClick={() => setSlotSize(id, s.key)}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <button className="btn btn-secondary imgslot-mini imgslot-remove" onClick={() => removeSlotImage(id)} title="Remove this image from the article">
                  🗑 Remove
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const fetchDraft = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const res = await fetch(`/api/content/drafts/${draftId}`);
      if (!res.ok) throw new Error("Draft not found");
      const data = await res.json();
      setDraft(data);

      // Initialize editable fields
      setSelectedHeadline(
        data.selected_headline || data.headline || data.headline_options?.[0] || ""
      );
      setCustomHeadline("");
      setBody(data.body_markdown || "");
      setExcerpt(data.excerpt || "");
      setSlug(data.slug || "");
      setMetaTitle(data.seo?.meta_title || "");
      setMetaDesc(data.seo?.meta_description || "");
      setKeywords(data.seo?.keywords || []);
      setHeroAlt(data.hero_image_alt || "");
      setHeroImageUrl(data.hero_image_url || "");
      setHeroImagePrompt(data.hero_image_prompt || "");
      if (!isPolling) {
        setSlots(
          (data.visual_suggestions || []).map((v: VisualSuggestion) => ({ ...v, size: v.size || "full" }))
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    fetchDraft(false);

    fetch("/api/settings/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.fal_connected) {
          setFalConnected(true);
        }
      })
      .catch(() => {});
  }, [fetchDraft]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const finalHeadline = customHeadline.trim() || selectedHeadline;
      await fetch(`/api/content/drafts/${draftId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_headline: finalHeadline,
          body_markdown: body,
          excerpt,
          slug,
          seo: {
            meta_title: metaTitle,
            meta_description: metaDesc,
            keywords,
          },
          hero_image_url: heroImageUrl,
          hero_image_prompt: heroImagePrompt,
          hero_image_alt: heroAlt,
          visual_suggestions: slots,
        }),
      });
      showToast("Draft saved ✓");
    } catch {
      showToast("Failed to save ✗");
    } finally {
      setSaving(false);
    }
  };

  const handleShip = async () => {
    if (!confirm("Ship this article? It will be packaged into a folder for publishing."))
      return;
    setShipping(true);
    try {
      const finalHeadline = customHeadline.trim() || selectedHeadline;
      // Bake image-slot tokens into final sized markdown for the public article.
      const publishBody = bakeImageSlots(body, slots);
      const res = await fetch("/api/content/ship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          selected_headline: finalHeadline,
          body_markdown: publishBody,
          slug,
          seo: {
            meta_title: metaTitle,
            meta_description: metaDesc,
            keywords,
          },
          hero_image_url: heroImageUrl,
          hero_image_prompt: heroImagePrompt,
          hero_image_alt: heroAlt,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(`Shipped! → ${data.folder_name}`);
    } catch (err) {
      showToast(`Ship failed: ${(err as Error).message}`);
    } finally {
      setShipping(false);
    }
  };

  const handleReject = async () => {
    if (!confirm("Reject this draft? It will be archived.")) return;
    try {
      await fetch(`/api/content/drafts/${draftId}`, { method: "DELETE" });
      router.push("/content");
    } catch {
      showToast("Failed to reject ✗");
    }
  };

  const removeKeyword = (idx: number) => {
    setKeywords((prev) => prev.filter((_, i) => i !== idx));
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords((prev) => [...prev, newKeyword.trim()]);
      setNewKeyword("");
    }
  };

  if (loading) {
    return (
      <>
        <header className="main-header">
          <h2>Loading...</h2>
        </header>
        <div className="main-body">
          <div
            className="loading-skeleton"
            style={{ width: "60%", height: 28, marginBottom: 20 }}
          />
          <div
            className="loading-skeleton"
            style={{ width: "100%", height: 400 }}
          />
        </div>
      </>
    );
  }

  if (error || !draft) {
    return (
      <>
        <header className="main-header">
          <h2>Error</h2>
        </header>
        <div className="main-body">
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <p>{error || "Draft not found"}</p>
            <button
              className="btn btn-secondary"
              onClick={() => router.push("/content")}
              style={{ marginTop: 12 }}
            >
              Back to Queue
            </button>
          </div>
        </div>
      </>
    );
  }

  const words = wordCount(body);
  const readTime = Math.max(1, Math.ceil(words / 250));
  const finalHeadline = customHeadline.trim() || selectedHeadline;

  return (
    <>
      {/* Toast */}
      {toast && <div className="review-toast">{toast}</div>}

      <header className="main-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={() => router.push("/content")}
            style={{ padding: "6px 10px" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h2>Review Article</h2>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              {words.toLocaleString()} words · {readTime} min read ·{" "}
              {draft.generation.model.split("/").pop()}
            </span>
          </div>
        </div>
      </header>

      <div className="main-body review-layout">
        {/* ── SECTION 1: Headline (AI-chosen) ── */}
        <section className="review-section">
          <h3 className="review-section-title">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M4 7V4h16v3" />
              <path d="M9 20h6" />
              <path d="M12 4v16" />
            </svg>
            Headline
          </h3>
          {editingHeadline ? (
            <input
              autoFocus
              className="input-field"
              value={headlineDraft}
              onChange={(e) => setHeadlineDraft(e.target.value)}
              onBlur={() => {
                const v = headlineDraft.trim();
                if (v) setSelectedHeadline(v);
                setEditingHeadline(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Escape") {
                  setEditingHeadline(false);
                }
              }}
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.3,
                width: "100%",
                margin: "4px 0 0",
                padding: "6px 10px",
              }}
            />
          ) : (
            <p
              onClick={() => {
                setHeadlineDraft(selectedHeadline);
                setEditingHeadline(true);
              }}
              title="Click to edit the headline"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 22,
                fontWeight: 700,
                lineHeight: 1.3,
                color: "var(--text-primary)",
                margin: "4px 0 0",
                cursor: "text",
                borderRadius: 6,
                padding: "6px 10px",
                marginLeft: -10,
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-card)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {selectedHeadline}
            </p>
          )}
        </section>

        {/* ── SECTION 2: Article Body ── */}
        <section className="review-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h3 className="review-section-title">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Article Body
            </h3>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageUpload(f, pendingImgRef.current);
                  pendingImgRef.current = null;
                  e.target.value = "";
                }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => {
                  pendingImgRef.current = null;
                  imageInputRef.current?.click();
                }}
                disabled={uploadingImage}
                style={{ fontSize: 12 }}
                title="Upload a real logo, screenshot or diagram and insert it at the cursor"
              >
                {uploadingImage ? "Uploading…" : "🖼 Insert image"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowEditor(!showEditor)}
                style={{ fontSize: 12 }}
              >
                {showEditor ? "Preview" : "Edit Markdown"}
              </button>
            </div>
          </div>

          {showEditor ? (
            <textarea
              ref={bodyRef}
              className="review-body-editor"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck
            />
          ) : (
            <div className="review-body-preview">
              <div dangerouslySetInnerHTML={{ __html: `<h1 class="md-h1">${finalHeadline.replace(/</g, "&lt;")}</h1>` }} />
              {(() => {
                const blocks = splitBlocks(body);
                const isDnD = dragIdx !== null;
                const dropZone = (gap: number) => (
                  <div
                    key={`dz-${gap}`}
                    className={`imgslot-dropzone ${isDnD ? "active" : ""} ${overGap === gap ? "over" : ""}`}
                    onDragOver={(e) => {
                      if (isDnD) {
                        e.preventDefault();
                        setOverGap(gap);
                      }
                    }}
                    onDragLeave={() => setOverGap((g) => (g === gap ? null : g))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx !== null) setBody(moveBlockInBody(body, dragIdx, gap));
                      setDragIdx(null);
                      setOverGap(null);
                    }}
                  />
                );
                const out: ReactNode[] = [];
                blocks.forEach((b, i) => {
                  out.push(dropZone(i));
                  const tok = slotTokenOf(b);
                  if (tok) {
                    out.push(
                      renderSlotCard(
                        slotById(tok.id) || { id: tok.id, kind: "photo", description: tok.desc, size: "full" as ImageSize },
                        i
                      )
                    );
                  } else {
                    out.push(<div key={`b-${i}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(b) }} />);
                  }
                });
                out.push(dropZone(blocks.length));
                return out;
              })()}
            </div>
          )}

          {/* Unplaced briefs — have no slot anchor in the body yet */}
          {(() => {
            const unplaced = slots.filter(
              (s) => s.id && s.kind !== "hero" && !new RegExp(`\\[IMAGE #${s.id}:`).test(body)
            );
            if (unplaced.length === 0) return null;
            return (
              <div className="imgslot-unplaced">
                <div className="imgslot-unplaced-head">🗂 Unplaced briefs — not in the article yet</div>
                {unplaced.map((s) => (
                  <div key={s.id} className="imgslot-unplaced-row">
                    <span className="imgslot-label">🖼 {s.id}</span>
                    <span className="imgslot-desc">{s.description}</span>
                    <button
                      className="btn btn-secondary imgslot-mini"
                      onClick={() => setBody((b) => `${b.trimEnd()}\n\n[IMAGE #${s.id}: ${s.description}]\n`)}
                      title="Drop this brief's slot at the end of the article (drag to reposition coming soon)"
                    >
                      + Add to article
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>

        {/* ── SECTION 3: Excerpt ── */}
        <section className="review-section">
          <h3 className="review-section-title">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <line x1="17" y1="10" x2="3" y2="10" />
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" />
              <line x1="17" y1="18" x2="3" y2="18" />
            </svg>
            Excerpt
          </h3>
          <textarea
            className="input-field"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={2}
            maxLength={200}
            style={{
              resize: "vertical",
              fontFamily: "var(--font-sans)",
              fontSize: 13,
            }}
          />
          <span
            style={{
              fontSize: 11,
              color:
                excerpt.length > 155
                  ? "var(--accent-rose)"
                  : "var(--text-muted)",
              marginTop: 4,
              display: "block",
            }}
          >
            {excerpt.length}/155 characters
          </span>
        </section>

        {/* ── SECTION 3.5: Hero Image ── */}
        <section className="review-section">
          <h3 className="review-section-title">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            Hero Image
          </h3>

          {heroImageUrl ? (
            <div className="review-image-preview-container" style={{ position: "relative", marginBottom: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroImageUrl}
                alt={heroAlt || "Hero preview"}
                style={{
                  width: "100%",
                  maxHeight: 300,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setHeroImageUrl("")}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  background: "rgba(11, 12, 15, 0.8)",
                  borderColor: "rgba(255, 255, 255, 0.2)",
                  color: "var(--accent-rose)",
                  padding: "4px 8px",
                  fontSize: 12,
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div
              style={{
                border: "2px dashed var(--border-subtle)",
                borderRadius: 8,
                padding: "24px 16px",
                textAlign: "center",
                color: "var(--text-muted)",
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              No hero image selected. Generate one below or enter a custom URL.
            </div>
          )}

          <div className="input-group" style={{ marginBottom: 12 }}>
            <label>Image URL (Local API path or external URL)</label>
            <input
              type="text"
              className="input-field"
              value={heroImageUrl}
              onChange={(e) => setHeroImageUrl(e.target.value)}
              placeholder="e.g. /api/content/images/hero-123.webp or https://example.com/image.jpg"
              style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
          </div>

          <div className="input-group">
            <label>AI Image Generation Prompt</label>
            <textarea
              className="input-field"
              value={heroImagePrompt}
              onChange={(e) => setHeroImagePrompt(e.target.value)}
              rows={2}
              placeholder="Describe the image you want DALL-E 3 to generate..."
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                resize: "vertical",
                marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  if (!heroImagePrompt.trim()) {
                    alert("Please write a prompt first.");
                    return;
                  }
                  setImageGenerating(true);
                  try {
                    const res = await fetch("/api/content/generate-image", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        prompt: heroImagePrompt,
                        articleId: draftId,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed to generate");
                    setHeroImageUrl(data.image_url);
                    showToast("Image generated successfully! ✓");
                  } catch (err) {
                    showToast(`Generation failed: ${(err as Error).message}`);
                  } finally {
                    setImageGenerating(false);
                  }
                }}
                disabled={imageGenerating}
                style={{ fontSize: 12 }}
              >
                {imageGenerating ? "Generating..." : `⚡ Generate AI Image (${falConnected ? "Flux Dev" : "DALL-E 3"})`}
              </button>
            </div>
          </div>
        </section>

        {/* ── SECTION 4: SEO Panel ── */}
        <section className="review-section">
          <button
            className="review-section-toggle"
            onClick={() => setSeoOpen(!seoOpen)}
          >
            <h3 className="review-section-title" style={{ margin: 0 }}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              SEO Settings
            </h3>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              style={{
                transform: seoOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {seoOpen && (
            <div className="review-seo-panel">
              <div className="input-group">
                <label>
                  Meta Title{" "}
                  <span
                    style={{
                      color:
                        metaTitle.length > 60
                          ? "var(--accent-rose)"
                          : "var(--text-muted)",
                      fontWeight: 400,
                    }}
                  >
                    ({metaTitle.length}/60)
                  </span>
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  maxLength={70}
                  style={{ fontFamily: "var(--font-sans)" }}
                />
              </div>

              <div className="input-group">
                <label>
                  Meta Description{" "}
                  <span
                    style={{
                      color:
                        metaDesc.length > 155
                          ? "var(--accent-rose)"
                          : "var(--text-muted)",
                      fontWeight: 400,
                    }}
                  >
                    ({metaDesc.length}/155)
                  </span>
                </label>
                <textarea
                  className="input-field"
                  value={metaDesc}
                  onChange={(e) => setMetaDesc(e.target.value)}
                  rows={2}
                  maxLength={200}
                  style={{ resize: "vertical", fontFamily: "var(--font-sans)" }}
                />
              </div>

              <div className="input-group">
                <label>Slug</label>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      padding: "8px 10px",
                      background: "var(--bg-elevated)",
                      borderRadius: "8px 0 0 8px",
                      border: "1px solid var(--border-subtle)",
                      borderRight: "none",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    /blog/
                  </span>
                  <input
                    type="text"
                    className="input-field"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    style={{
                      borderRadius: "0 8px 8px 0",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  />
                </div>
              </div>

              <div className="input-group">
                <label>Keywords</label>
                <div className="review-keywords">
                  {keywords.map((kw, i) => (
                    <span key={i} className="review-keyword-chip">
                      {kw}
                      <button
                        onClick={() => removeKeyword(i)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "inherit",
                          cursor: "pointer",
                          padding: "0 0 0 4px",
                          fontSize: 12,
                          opacity: 0.7,
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="Add keyword"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    style={{
                      flex: 1,
                      fontFamily: "var(--font-sans)",
                      fontSize: 12,
                    }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={addKeyword}
                    style={{ fontSize: 12 }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Hero image alt */}
              <div className="input-group">
                <label>Hero Image Alt Text</label>
                <input
                  type="text"
                  className="input-field"
                  value={heroAlt}
                  onChange={(e) => setHeroAlt(e.target.value)}
                  placeholder="Descriptive alt text for the hero image"
                  style={{ fontFamily: "var(--font-sans)" }}
                />
              </div>

              {/* Image prompt display */}
              {draft.hero_image_prompt && (
                <div className="input-group">
                  <label>AI Image Prompt</label>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      fontStyle: "italic",
                      padding: "8px 12px",
                      background: "var(--bg-primary)",
                      borderRadius: 6,
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {draft.hero_image_prompt}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── SECTION 5: Source Attribution ── */}
        <section className="review-section">
          <h3 className="review-section-title">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            Source Articles
          </h3>
          <div className="review-sources">
            {draft.source_articles.map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="review-source-card"
              >
                <span className="review-source-name">{src.source_name}</span>
                <span className="review-source-title">{src.title}</span>
                {src.excerpt && (
                  <span className="review-source-excerpt">{src.excerpt}</span>
                )}
              </a>
            ))}
          </div>
        </section>
      </div>

      {/* ── Sticky Action Bar ── */}
      <div className="review-action-bar">
        <div className="review-action-bar-inner">
          <button
            className="btn btn-primary review-action-btn"
            onClick={handleShip}
            disabled={shipping}
          >
            {shipping ? (
              <>
                <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                Shipping...
              </>
            ) : (
              <>
                🚀 Ship
              </>
            )}
          </button>
          <button
            className="btn btn-secondary review-action-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "💾 Save Draft"}
          </button>
          <button
            className="btn btn-secondary review-action-btn"
            onClick={async () => {
              await handleSave();
              window.open(`/admin/content/review/${draftId}/preview`, "_blank");
            }}
            title="See exactly how this will look once published"
          >
            👁 Preview
          </button>
          <button
            className="btn btn-secondary review-action-btn"
            onClick={handleReject}
            style={{
              color: "var(--accent-rose)",
              borderColor: "rgba(244, 63, 94, 0.2)",
            }}
          >
            ✗ Reject
          </button>
        </div>
      </div>
    </>
  );
}
