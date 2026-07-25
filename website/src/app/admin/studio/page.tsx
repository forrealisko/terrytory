"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/formats";

/* ── Types (mirror system/content/creative-director.mjs output) ── */
interface IdeaSource {
  source_name?: string;
  title?: string;
  url?: string;
}
interface Idea {
  id: string;
  status: "proposed" | "created" | "chosen" | "banked";
  format: string;
  title: string;
  angle: string;
  audience?: string;
  rationale: string;
  priority: number;
  source_articles: IdeaSource[];
  draft_id: string | null;
}


export default function StudioPage() {
  const [slate, setSlate] = useState<Idea[]>([]);
  const [banked, setBanked] = useState<Idea[]>([]);
  const [niche, setNiche] = useState<string>("ai");
  const [planning, setPlanning] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [log, setLog] = useState<string>("");
  const [showBank, setShowBank] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const loadIdeas = useCallback(async () => {
    const res = await fetch("/api/content/ideas");
    if (!res.ok) return;
    const d = await res.json();
    setSlate(d.slate || []);
    setBanked(d.banked || []);
    if (d.niche) setNiche(d.niche);
  }, []);

  useEffect(() => {
    loadIdeas();
  }, [loadIdeas]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function runStream(url: string, body: Record<string, unknown>) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Failures come back as JSON rather than a log stream, so read the message
    // out instead of piping raw JSON into the console the user is reading.
    if (!res.ok) {
      const msg = await res
        .json()
        .then((b) => b.error as string | undefined)
        .catch(() => undefined);
      setLog((l) => l + `\n⚠ ${msg || `Request failed (${res.status})`}\n`);
      return;
    }
    if (!res.body) {
      setLog((l) => l + `\n[no response stream — ${res.status}]`);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      setLog((l) => l + dec.decode(value));
    }
  }

  async function plan() {
    setPlanning(true);
    setLog(`▶ Creative Director suggesting 8 ideas…\n`);
    try {
      // count 0 → the planner's default spread (8). These are cheap sketches;
      // nothing is written until an idea is clicked.
      await runStream("/api/content/ideas/plan", { count: 0 });
      await loadIdeas();
    } finally {
      setPlanning(false);
    }
  }

  // `tier` overrides the writer model for this run only — used by "Rewrite
  // (best)" so a draft written on the cheap tier can be redone properly without
  // changing the global spend setting.
  async function create(id: string, tier?: "low" | "medium" | "best") {
    setCreatingId(id);
    setLog(tier ? `▶ Rewriting with the ${tier} writer…\n` : `▶ Creating draft…\n`);
    try {
      await runStream("/api/content/ideas/create", tier ? { id, tier } : { id });
      await loadIdeas();
    } finally {
      setCreatingId(null);
    }
  }

  async function status(id: string, action: "choose" | "bank" | "restore") {
    setBusyId(id);
    try {
      await fetch("/api/content/ideas/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await loadIdeas();
    } finally {
      setBusyId(null);
    }
  }

  const busy = planning || creatingId !== null;

  return (
    <div className="studio">
      <header className="main-header">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h2 style={{ margin: 0 }}>Creative Director</h2>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            8 ideas for {niche.toUpperCase()}. Nothing gets written until you click one.
          </span>
        </div>
        <div className="main-header-actions" style={{ gap: 10 }}>
          <button className="studio-plan-btn" onClick={plan} disabled={busy}>
            {planning ? "Thinking…" : "✨ Suggest ideas"}
          </button>
        </div>
      </header>

      <div className="studio-body">
        {busy && (
          <pre ref={logRef} className="studio-log">
            {log}
          </pre>
        )}

        {/* Today's slate */}
        <section>
          <div className="studio-section-head">
            <h3>Today&apos;s slate</h3>
            <span className="studio-muted">{slate.length} idea{slate.length === 1 ? "" : "s"}</span>
          </div>

          {slate.length === 0 && !planning && (
            <div className="studio-empty">
              No ideas yet. Hit <strong>Generate today&apos;s slate</strong> and the Creative Director will
              propose 2–5 pieces from the latest stories.
            </div>
          )}

          <div className="studio-grid">
            {slate.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                creating={creatingId === idea.id}
                busy={busyId === idea.id || busy}
                onCreate={() => create(idea.id)}
                onChoose={() => status(idea.id, "choose")}
                onBank={() => status(idea.id, "bank")}
                onRewrite={() => create(idea.id, "best")}
              />
            ))}
          </div>
        </section>

        {/* Idea bank */}
        {banked.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div className="studio-section-head" style={{ cursor: "pointer" }} onClick={() => setShowBank((s) => !s)}>
              <h3>🗄 Idea bank <span className="studio-muted">({banked.length})</span></h3>
              <span className="studio-muted">{showBank ? "hide" : "show"}</span>
            </div>
            {showBank && (
              <div className="studio-grid">
                {banked.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    creating={creatingId === idea.id}
                    busy={busyId === idea.id || busy}
                    banked
                    onCreate={() => create(idea.id)}
                    onRestore={() => status(idea.id, "restore")}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function IdeaCard({
  idea,
  creating,
  busy,
  banked,
  onCreate,
  onChoose,
  onBank,
  onRestore,
  onRewrite,
}: {
  idea: Idea;
  creating: boolean;
  busy: boolean;
  banked?: boolean;
  onCreate: () => void;
  onChoose?: () => void;
  onBank?: () => void;
  onRestore?: () => void;
  onRewrite?: () => void;
}) {
  const f = fmt(idea.format);
  const created = idea.status === "created";
  return (
    <div className={`studio-card ${created ? "created" : ""}`}>
      <div className="studio-card-top">
        <span className="studio-fmt">
          {f.emoji} {f.label}
        </span>
        {created && <span className="studio-ready">draft ready</span>}
        {!banked && !created && <span className="studio-priority">#{idea.priority}</span>}
      </div>

      <h4 className="studio-title">{idea.title}</h4>
      {idea.angle && <p className="studio-angle">{idea.angle}</p>}
      {idea.rationale && <p className="studio-why">Why now: {idea.rationale}</p>}
      {idea.audience && <span className="studio-audience">For {idea.audience}</span>}

      {idea.source_articles?.[0]?.url && (
        <a className="studio-src" href={idea.source_articles[0].url} target="_blank" rel="noopener noreferrer">
          {idea.source_articles.length} source{idea.source_articles.length === 1 ? "" : "s"} ↗
        </a>
      )}

      <div className="studio-actions">
        {creating ? (
          <span className="studio-working">
            <span className="loading-spinner" style={{ width: 12, height: 12 }} /> creating…
          </span>
        ) : created ? (
          <>
            <button className="studio-btn primary" onClick={onChoose} disabled={busy}>
              ✓ Choose
            </button>
            <a className="studio-btn ghost" href={`/admin/content/review/${idea.draft_id}`}>
              📝 Review
            </a>
            {onRewrite && (
              <button
                className="studio-btn ghost"
                onClick={onRewrite}
                disabled={busy}
                title="Write it again with the best writer model, whatever the spend tier is set to"
              >
                ↻ Rewrite (best)
              </button>
            )}
            {onBank && (
              <button className="studio-btn ghost" onClick={onBank} disabled={busy}>
                🗄 Bank
              </button>
            )}
          </>
        ) : (
          <>
            <button className="studio-btn primary" onClick={onCreate} disabled={busy}>
              ✍️ Create draft
            </button>
            {banked ? (
              <button className="studio-btn ghost" onClick={onRestore} disabled={busy}>
                ↑ To slate
              </button>
            ) : (
              <button className="studio-btn ghost" onClick={onBank} disabled={busy}>
                🗄 Bank
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
