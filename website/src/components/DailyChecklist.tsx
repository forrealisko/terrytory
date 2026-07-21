"use client";

/**
 * The daily ritual. One panel on the admin home that answers "what do I do
 * today" — pick a story, shape it, ship it — plus how close the publication is
 * to its next milestone.
 *
 * The plan is one article a day, by hand. That only sticks if it feels small
 * and gives a little reward, so: a checklist that resets each morning, and a
 * progress bar toward 20 → 50 → 100 published.
 *
 * State is restored after mount, never during render — reading localStorage in
 * a useState initializer makes the client's first paint disagree with the
 * server's and React leaves the mismatch unpatched.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const STEPS = [
  { key: "pick", label: "Pick a story", href: "/admin/studio", hint: "AI or Tech — whatever you feel" },
  { key: "draft", label: "Create the draft", href: "/admin/studio", hint: "One click in the Studio" },
  { key: "edit", label: "Edit it in your voice", href: "/admin/content", hint: "Every change trains the AI" },
  { key: "ship", label: "Ship it 🚀", href: "/admin/content", hint: "Pull the trigger" },
];

function todayKey() {
  return `daily_checklist_${new Date().toISOString().slice(0, 10)}`;
}

interface Goal {
  total: number;
  next: number | null;
  prevMilestone: number;
  remaining: number;
}

export function DailyChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [goal, setGoal] = useState<Goal | null>(null);
  const [ready, setReady] = useState(false);

  // Restore today's ticks after mount (see note above).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(todayKey());
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    fetch("/api/content/goal")
      .then((r) => r.json())
      .then(setGoal)
      .catch(() => {});
  }, []);

  const toggle = (key: string) => {
    setDone((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(todayKey(), JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const completedToday = STEPS.filter((s) => done[s.key]).length;
  const allDone = completedToday === STEPS.length;

  // Progress within the current milestone band (e.g. 14 of the way from 0→20).
  let pct = 0;
  if (goal?.next) {
    const span = goal.next - goal.prevMilestone;
    pct = span > 0 ? Math.min(100, ((goal.total - goal.prevMilestone) / span) * 100) : 0;
  } else if (goal) {
    pct = 100;
  }

  return (
    <div className="daily-card">
      <div className="daily-head">
        <div>
          <span className="daily-kicker">TODAY</span>
          <h3 className="daily-title">
            {allDone ? "Done for today — nice one 🙌" : "One article. That's the whole job."}
          </h3>
        </div>
        {ready && (
          <span className="daily-count">
            {completedToday}/{STEPS.length}
          </span>
        )}
      </div>

      <div className="daily-steps">
        {STEPS.map((s) => {
          const checked = !!done[s.key];
          return (
            <div key={s.key} className={`daily-step${checked ? " checked" : ""}`}>
              <button
                className="daily-check"
                onClick={() => toggle(s.key)}
                aria-label={checked ? "Mark not done" : "Mark done"}
              >
                {checked ? "✓" : ""}
              </button>
              <div className="daily-step-body">
                <Link href={s.href} className="daily-step-label">
                  {s.label}
                </Link>
                <span className="daily-step-hint">{s.hint}</span>
              </div>
            </div>
          );
        })}
      </div>

      {goal && (
        <div className="daily-goal">
          <div className="daily-goal-row">
            <span className="daily-goal-label">
              {goal.next ? (
                <>
                  <b>{goal.total}</b> published · {goal.remaining} to go to{" "}
                  <b>{goal.next}</b>
                </>
              ) : (
                <>
                  <b>{goal.total}</b> published — all milestones cleared 🏆
                </>
              )}
            </span>
            <span className="daily-goal-milestones">20 · 50 · 100</span>
          </div>
          <div className="daily-goal-track">
            <div className="daily-goal-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
