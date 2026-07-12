"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MODELS } from "@/lib/models";

/* ───────────────────────────── Types ───────────────────────────── */

interface PickSource {
  source_id?: string;
  source_name?: string;
  title?: string;
  url?: string;
}

interface Pick {
  id: string;
  headline: string;
  rating: number;
  summary?: string;
  reasoning?: string;
  source_articles?: PickSource[];
}

interface Message {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  kind?: "text" | "brief";
  picks?: Pick[];
  /** headline to use if this assistant message is saved as a draft */
  title?: string;
  sources?: PickSource[];
  saved?: { id: string; slug: string; niche: string };
  saveError?: string;
}

interface NicheInfo {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  accent: string;
}

interface Session {
  id: string;
  title: string;
  niche: string;
  type: "brief" | "report" | "free";
  date: string; // yyyy-mm-dd
  createdAt: number;
  messages: Message[];
  briefed?: boolean;
}

/* ─────────────────────────── Constants ─────────────────────────── */

const SESSIONS_KEY = "terrytory_editorial_sessions";
const ACTIVE_KEY = "terrytory_editorial_active";
const MODEL_KEY = "terrytory_editorial_model";
const DEFAULT_MODEL = "openai/gpt-4o";

const todayStr = () => new Date().toISOString().slice(0, 10);

/* ────────────────────────── Markdown render ─────────────────────── */

function renderMarkdown(text: string): string {
  if (!text) return "";
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<div class="blog-body-image-container"><img src="$2" alt="$1" class="blog-body-image" /><span class="blog-body-image-caption">$1</span></div>',
  );
  html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<div[\s\S]*?<\/div>|<h[1-3]>[\s\S]*?<\/h[1-3]>)/);
  for (let i = 0; i < parts.length; i++) {
    if (!/^<(pre|div|h[1-3])/.test(parts[i])) {
      parts[i] = parts[i].replace(/\n/g, "<br />");
    }
  }
  return parts.join("");
}

/** Best-effort headline for saving: first H1, else first non-empty line. */
function deriveTitle(md: string, fallback: string): string {
  const h1 = md.match(/^\s*#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const line = md.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return (line || fallback).replace(/^#+\s*/, "").slice(0, 120);
}

/** Heuristic: does this reply read like a full article worth saving? */
function looksLikeArticle(md: string): boolean {
  return md.trim().length > 500 && (/^#\s+/m.test(md) || md.split(/\n\s*\n/).length >= 4);
}

/* ─────────────────────────── Component ─────────────────────────── */

export default function EditorialChatPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [niches, setNiches] = useState<NicheInfo[]>([]);
  const [activeNiche, setActiveNiche] = useState<string>("ai");
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const briefing = useRef(false);

  const active = sessions.find((s) => s.id === activeId) || null;
  const niche = niches.find((n) => n.id === (active?.niche || activeNiche)) || null;

  /* ── Load persisted state + niches on mount ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) setSessions(JSON.parse(raw));
      const savedActive = localStorage.getItem(ACTIVE_KEY);
      if (savedActive) setActiveId(savedActive);
      const savedModel = localStorage.getItem(MODEL_KEY);
      if (savedModel) setModel(savedModel);
    } catch {
      /* ignore corrupt storage */
    }

    fetch("/api/niches")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.niches)) setNiches(d.niches);
        if (d.active) setActiveNiche(d.active);
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  /* ── Persist ── */
  useEffect(() => {
    if (loaded.current) localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  }, [sessions]);
  useEffect(() => {
    if (loaded.current && activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);
  useEffect(() => {
    if (loaded.current) localStorage.setItem(MODEL_KEY, model);
  }, [model]);

  /* ── Ensure a "today" brief session exists once niches resolve ──
     Auto-creation is currently DISABLED — Desk is de-emphasized for now. The
     manual "+ Daily brief" button still creates a brief on demand. We keep the
     "select an existing brief if nothing is active" fallback so returning to a
     previously-created brief still works, but never silently mint a new one. */
  useEffect(() => {
    if (!loaded.current || !niches.length) return;
    if (activeId) return;
    const date = todayStr();
    const s = sessions.find((x) => x.type === "brief" && x.date === date && x.niche === activeNiche);
    if (s) setActiveId(s.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [niches, activeNiche, loaded.current]);

  /* ── Auto-post the daily brief for a fresh brief session ── */
  useEffect(() => {
    if (!active || active.type !== "brief" || active.briefed || briefing.current) return;
    if (active.messages.length > 0) return;
    void postBrief(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active?.messages.length]);

  /* ── Keep the global niche cookie aligned with the active session ── */
  // Drafts save under the session's niche, but CREATE + the sidebar read the
  // `niche` cookie. Without this, saving from an AI session while the cookie
  // says "tech" hides the draft in CREATE. Keep them in lockstep.
  useEffect(() => {
    if (!active) return;
    document.cookie = `niche=${active.niche}; path=/; max-age=31536000; samesite=lax`;
    if (active.niche !== activeNiche) setActiveNiche(active.niche);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.niche]);

  /* ── Keep pinned to bottom ── */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, loading]);

  /* ────────────── Session helpers ────────────── */

  function newSession(type: Session["type"], nicheId: string): Session {
    const date = todayStr();
    const nInfo = niches.find((n) => n.id === nicheId);
    const label =
      type === "brief"
        ? `Daily Brief · ${nInfo?.shortName || nicheId.toUpperCase()}`
        : type === "report"
        ? `Weekly Report · ${nInfo?.shortName || nicheId.toUpperCase()}`
        : `Notes · ${nInfo?.shortName || nicheId.toUpperCase()}`;
    return {
      id: `${type}-${nicheId}-${Date.now()}`,
      title: label,
      niche: nicheId,
      type,
      date,
      createdAt: Date.now(),
      messages: [],
    };
  }

  function startSession(type: Session["type"]) {
    const s = newSession(type, activeNiche);
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    if (type === "report") void postWeeklyReport(s);
  }

  function patchActive(fn: (s: Session) => Session) {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? fn(s) : s)));
  }

  function pushMessage(sessionId: string, msg: Message) {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messages: [...s.messages, msg] } : s)),
    );
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (id === activeId) setActiveId(next[0]?.id || "");
      return next;
    });
  }

  /* ────────────── Editorial system prompt ────────────── */

  function systemPrompt(sess: Session, picks: Pick[]): string {
    const n = niches.find((x) => x.id === sess.niche);
    const brand = n?.name || sess.niche;
    const tagline = n?.tagline || "";
    const slate =
      picks.length > 0
        ? picks
            .slice(0, 8)
            .map((p) => `- (${p.rating}/10) ${p.headline}${p.source_articles?.[0]?.url ? ` — ${p.source_articles[0].url}` : ""}`)
            .join("\n")
        : "No fresh picks in the queue right now.";

    const reportMode = sess.type === "report";

    return [
      `You are the managing editor for ${brand}${tagline ? ` — "${tagline}"` : ""}, a publication in the Terrytory network.`,
      `Today is ${sess.date}. You cover the "${sess.niche}" beat.`,
      ``,
      `Voice: sharp, factual, engaging journalism. Signal over hype. Strong ledes, short paragraphs, concrete detail, no filler or breathless clichés.`,
      ``,
      reportMode
        ? `The editor wants a WEEKLY REPORT: synthesize the week's slate into a briefing — the 3–5 biggest threads, why they matter, and what to watch next. Use clear H2 sections and tight bullets.`
        : `When the editor asks you to DRAFT an article, output a COMPLETE, publication-ready article in Markdown:
- One H1 headline (# ...), then 600–1000 words.
- Ground every claim in the provided source(s); never fabricate quotes or statistics.
- Structure with short paragraphs and optional H2 subheads; close with a forward-looking kicker.
When asked for ANGLES, give 3–5 concise bullet options. Keep ordinary chat replies tight and skimmable.`,
      ``,
      `Today's story slate:`,
      slate,
    ].join("\n");
  }

  /* ────────────── LLM call ────────────── */

  async function callModel(sess: Session, visible: Message[], picks: Pick[]): Promise<Message> {
    const sys = { role: "system" as const, content: systemPrompt(sess, picks) };
    const history = visible
      .filter((m) => m.kind !== "brief" || m.content) // briefs carry intro text
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [sys, ...history], includeScrapedContext: false }),
    });
    const data = await res.json();

    if (!res.ok) {
      return { role: "assistant", content: `⚠️ ${data.error || "Model request failed."}` };
    }

    const choice = data.choices?.[0]?.message;
    let content: string = choice?.content || "No reply returned.";
    let reasoning: string = choice?.reasoning || choice?.reasoning_content || "";
    if (content.includes("<think>")) {
      const parts = content.split("</think>");
      if (parts.length > 1) {
        reasoning = parts[0].replace("<think>", "").trim();
        content = parts.slice(1).join("</think>").trim();
      }
    }
    return { role: "assistant", content, reasoning: reasoning || undefined };
  }

  /**
   * Append a user message and the model's reply. The message array is built
   * explicitly (not read back from state) so the model always sees the turn
   * that just happened — reading sessionsRef here would lag a render behind.
   */
  async function deliver(sess: Session, userMsg: Message, opts?: { title?: string; sources?: PickSource[] }) {
    const base = sessionsRef.current.find((s) => s.id === sess.id) || sess;
    const nextMsgs = [...base.messages, userMsg];
    setSessions((prev) => prev.map((s) => (s.id === sess.id ? { ...s, messages: nextMsgs } : s)));
    setLoading(true);
    try {
      const picks = collectPicks(base);
      const reply = await callModel(base, nextMsgs, picks);
      if (opts?.title && looksLikeArticle(reply.content)) {
        reply.title = opts.title;
        reply.sources = opts.sources;
      }
      setSessions((prev) => prev.map((s) => (s.id === sess.id ? { ...s, messages: [...s.messages, reply] } : s)));
    } catch (err) {
      const errMsg: Message = { role: "assistant", content: `⚠️ Network error: ${(err as Error).message}` };
      setSessions((prev) => prev.map((s) => (s.id === sess.id ? { ...s, messages: [...s.messages, errMsg] } : s)));
    } finally {
      setLoading(false);
    }
  }

  // keep a ref to sessions so async turns read fresh state
  const sessionsRef = useRef<Session[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  function collectPicks(sess: Session): Pick[] {
    const brief = sess.messages.find((m) => m.kind === "brief");
    return brief?.picks || [];
  }

  /* ────────────── Daily brief ────────────── */

  async function postBrief(sess: Session) {
    briefing.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/content/picks?niche=${encodeURIComponent(sess.niche)}`);
      const data = await res.json().catch(() => ({}));
      const picks: Pick[] = Array.isArray(data.picks) ? data.picks : [];
      const n = niches.find((x) => x.id === sess.niche);
      const brand = n?.name || sess.niche.toUpperCase();

      const intro =
        picks.length > 0
          ? `**Good morning.** Here's today's slate for **${brand}** — ${picks.length} topic${picks.length === 1 ? "" : "s"} in the queue, hottest first. Tell me which to draft, or ask for angles.`
          : `**Good morning.** No fresh picks for **${brand}** yet. Run the scraper (SCRAPER tab) or star a topic, then start a new brief. You can still ask me anything below.`;

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sess.id
            ? {
                ...s,
                briefed: true,
                messages: [
                  ...s.messages,
                  { role: "assistant", content: intro, kind: "brief", picks: picks.slice(0, 8) },
                ],
              }
            : s,
        ),
      );
    } catch (err) {
      pushMessage(sess.id, {
        role: "assistant",
        content: `⚠️ Couldn't load today's picks: ${(err as Error).message}`,
        kind: "brief",
        picks: [],
      });
      patchActive((s) => ({ ...s, briefed: true }));
    } finally {
      setLoading(false);
      briefing.current = false;
    }
  }

  async function postWeeklyReport(sess: Session) {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/picks?niche=${encodeURIComponent(sess.niche)}`);
      const data = await res.json().catch(() => ({}));
      const picks: Pick[] = Array.isArray(data.picks) ? data.picks : [];
      // seed a brief-style context message (invisible-ish) so systemPrompt has the slate
      const seeded: Session = {
        ...sess,
        messages: [
          { role: "assistant", content: "", kind: "brief", picks: picks.slice(0, 12) },
          { role: "user", content: "Write this week's editorial report." },
        ],
      };
      setSessions((prev) => prev.map((s) => (s.id === sess.id ? seeded : s)));
      const reply = await callModel(seeded, seeded.messages, picks);
      pushMessage(sess.id, reply);
    } catch (err) {
      pushMessage(sess.id, { role: "assistant", content: `⚠️ ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  }

  /* ────────────── User actions ────────────── */

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim() || loading || !active) return;
    const text = input.trim();
    setInput("");
    await deliver(active, { role: "user", content: text });
  }

  async function draftPick(p: Pick) {
    if (!active || loading) return;
    await deliver(
      active,
      { role: "user", content: `✍️ Draft the article: "${p.headline}"` },
      { title: p.headline, sources: p.source_articles },
    );
  }

  async function anglesPick(p: Pick) {
    if (!active || loading) return;
    await deliver(active, {
      role: "user",
      content: `Give me 3–5 angles and the sharpest "why it matters" for: "${p.headline}"`,
    });
  }

  async function saveDraftFromMessage(msgIndex: number) {
    if (!active) return;
    const msg = active.messages[msgIndex];
    if (!msg || msg.role !== "assistant") return;
    const title = msg.title || deriveTitle(msg.content, "Untitled draft");
    try {
      const res = await fetch("/api/content/chat-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: active.niche, title, markdown: msg.content, sources: msg.sources }),
      });
      const data = await res.json();
      setSessions((prev) =>
        prev.map((s) =>
          s.id === active.id
            ? {
                ...s,
                messages: s.messages.map((m, i) =>
                  i === msgIndex
                    ? res.ok
                      ? { ...m, saved: { id: data.id, slug: data.slug, niche: data.niche } }
                      : { ...m, saveError: data.error || "Save failed" }
                    : m,
                ),
              }
            : s,
        ),
      );
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === active.id
            ? {
                ...s,
                messages: s.messages.map((m, i) =>
                  i === msgIndex ? { ...m, saveError: (err as Error).message } : m,
                ),
              }
            : s,
        ),
      );
    }
  }

  function switchNiche(id: string) {
    setActiveNiche(id);
    document.cookie = `niche=${id}; path=/; max-age=31536000; samesite=lax`;
    const date = todayStr();
    const existing = sessions.find((s) => s.type === "brief" && s.date === date && s.niche === id);
    if (existing) setActiveId(existing.id);
    // else the ensure-brief effect will create one
  }

  const grouped = useMemo(() => groupSessions(sessions), [sessions]);

  /* ────────────── Render ────────────── */

  return (
    <div className="ed-shell">
      {/* Session rail */}
      <aside className="ed-rail">
        <div className="ed-rail-head">
          <span>Sessions</span>
        </div>
        <div className="ed-rail-actions">
          <button className="ed-new" onClick={() => startSession("brief")}>+ Daily brief</button>
          <button className="ed-new ghost" onClick={() => startSession("report")}>Weekly report</button>
        </div>
        <div className="ed-rail-list">
          {grouped.map((g) => (
            <div key={g.label} className="ed-rail-group">
              <div className="ed-rail-group-label">{g.label}</div>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  className={`ed-rail-item ${s.id === activeId ? "active" : ""}`}
                  onClick={() => setActiveId(s.id)}
                >
                  <span className="ed-rail-dot" data-type={s.type} />
                  <span className="ed-rail-item-title">{s.title}</span>
                  <span
                    className="ed-rail-del"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          ))}
          {sessions.length === 0 && <div className="ed-rail-empty">No sessions yet.</div>}
        </div>
      </aside>

      {/* Main */}
      <div className="ed-main">
        <header className="main-header ed-header">
          <div style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ margin: 0 }}>{active?.title || "Editorial Desk"}</h2>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {niche?.tagline || "Your daily newsroom assistant"}
            </span>
          </div>

          <div className="ed-header-actions">
            {niches.length > 1 && (
              <div className="ed-niche-tabs">
                {niches.map((n) => (
                  <button
                    key={n.id}
                    className={`ed-niche-tab ${n.id === activeNiche ? "active" : ""}`}
                    style={n.id === activeNiche ? { color: n.accent, borderColor: `${n.accent}55`, background: `${n.accent}12` } : undefined}
                    onClick={() => switchNiche(n.id)}
                  >
                    <span className="ed-niche-dot" style={{ background: n.accent }} />
                    {n.shortName}
                  </button>
                ))}
              </div>
            )}
            <select
              className="input-field ed-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <optgroup label="Standard">
                {MODELS.filter((m) => m.type === "standard").map((m) => (
                  <option key={m.id} value={m.id}>{m.provider} — {m.name}</option>
                ))}
              </optgroup>
              <optgroup label="Reasoning">
                {MODELS.filter((m) => m.type === "thinking").map((m) => (
                  <option key={m.id} value={m.id}>{m.provider} — {m.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </header>

        <div className="chat-messages-container">
          {active?.messages.map((m, idx) => (
            <div key={idx} className={`chat-message-row ${m.role}`}>
              <div className="chat-bubble">
                {m.role === "assistant" && m.reasoning && (
                  <div className="thinking-card">
                    <div
                      className={`thinking-card-header ${expanded[`${activeId}:${idx}`] ? "open" : ""}`}
                      onClick={() => setExpanded((p) => ({ ...p, [`${activeId}:${idx}`]: !p[`${activeId}:${idx}`] }))}
                    >
                      <span>⚡ Thinking Process</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                    {expanded[`${activeId}:${idx}`] && <div className="thinking-content">{m.reasoning}</div>}
                  </div>
                )}

                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />

                {/* Daily brief pick cards */}
                {m.kind === "brief" && m.picks && m.picks.length > 0 && (
                  <div className="ed-picks">
                    {m.picks.map((p) => (
                      <div key={p.id} className="ed-pick">
                        <div className="ed-pick-top">
                          <span className="ed-pick-rating">{p.rating}/10</span>
                          <span className="ed-pick-headline">{p.headline}</span>
                        </div>
                        {(p.summary || p.reasoning) && (
                          <p className="ed-pick-sum">{p.summary || p.reasoning}</p>
                        )}
                        <div className="ed-pick-actions">
                          <button onClick={() => draftPick(p)} disabled={loading}>✍️ Draft it</button>
                          <button className="ghost" onClick={() => anglesPick(p)} disabled={loading}>🔎 Angles</button>
                          {p.source_articles?.[0]?.url && (
                            <a href={p.source_articles[0].url} target="_blank" rel="noopener noreferrer" className="ed-pick-src">
                              source ↗
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Save-as-draft affordance */}
                {m.role === "assistant" && m.kind !== "brief" && looksLikeArticle(m.content) && (
                  <div className="ed-save-row">
                    {m.saved ? (
                      <a className="ed-saved" href="/admin/content">✓ Saved to drafts — open CREATE →</a>
                    ) : (
                      <>
                        <button className="ed-save-btn" onClick={() => saveDraftFromMessage(idx)}>
                          💾 Save as draft
                        </button>
                        {m.saveError && <span className="ed-save-err">{m.saveError}</span>}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-message-row assistant">
              <div className="chat-bubble" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="loading-spinner" style={{ width: 14, height: 14 }} />
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Working…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={send} className="chat-input-bar">
          <div className="chat-input-wrapper">
            <textarea
              className="chat-textarea"
              placeholder={active ? `Message your ${niche?.shortName || activeNiche} editor…` : "Start a session"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              disabled={!active}
            />
            <button type="submit" className="chat-send-btn" disabled={loading || !input.trim() || !active}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="chat-meta-bar">
            <span>Drafts you save land in the CREATE queue for review &amp; publishing.</span>
            <span style={{ fontSize: 11, opacity: 0.8 }}>Enter to send · Shift+Enter for newline</span>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function groupSessions(sessions: Session[]): { label: string; items: Session[] }[] {
  const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
  const today = todayStr();
  const groups: Record<string, Session[]> = {};
  for (const s of sorted) {
    const label = s.date === today ? "Today" : s.date;
    (groups[label] ||= []).push(s);
  }
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}
