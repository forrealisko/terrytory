/**
 * IDEA STORE — the Creative Director's daily scenarios.
 *
 * Ideas live in system/content/niches/<niche>/ideas/*.json, written by
 * system/content/creative-director.mjs. Lifecycle:
 *   proposed → created (draft generated) → chosen | banked
 * Banked ideas are the reuse pool. Writes only work where the FS is writable
 * (local / CI) — the deployed Vercel app is read-only.
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_NICHE, nichePaths } from "./niches";

export type IdeaStatus = "proposed" | "created" | "chosen" | "banked";

export interface IdeaSource {
  source_id?: string;
  source_name?: string;
  title?: string;
  url?: string;
  excerpt?: string;
}

export interface Idea {
  id: string;
  niche: string;
  batch_id: string;
  created_at: string;
  status: IdeaStatus;
  format: string;
  title: string;
  angle: string;
  rationale: string;
  priority: number;
  source_pick_ids: string[];
  source_articles: IdeaSource[];
  draft_id: string | null;
  planner_model?: string;
  created_draft_at?: string;
}

function ideasDir(niche: string): string {
  return nichePaths(niche).ideas;
}

export function listIdeas(niche: string = DEFAULT_NICHE): Idea[] {
  const dir = ideasDir(niche);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const ideas: Idea[] = [];
  for (const f of files) {
    try {
      ideas.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Idea);
    } catch {
      /* skip corrupt */
    }
  }
  // Newest batch first; within a batch, strongest (priority 1) first.
  ideas.sort((a, b) => {
    const t = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (t !== 0) return t;
    return (a.priority || 99) - (b.priority || 99);
  });
  return ideas;
}

export function getIdea(niche: string, id: string): Idea | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(ideasDir(niche), `${id}.json`), "utf-8")) as Idea;
  } catch {
    return null;
  }
}

/** Overwrite an idea file. Throws on read-only FS — callers should catch. */
export function saveIdea(niche: string, idea: Idea): void {
  const dir = ideasDir(niche);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${idea.id}.json`);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(idea, null, 2));
  fs.renameSync(tmp, file);
}

export function updateIdea(niche: string, id: string, patch: Partial<Idea>): Idea | null {
  const idea = getIdea(niche, id);
  if (!idea) return null;
  const updated = { ...idea, ...patch, id: idea.id };
  saveIdea(niche, updated);
  return updated;
}

/** The batch_id of the most recently planned slate, or null. */
export function latestBatchId(niche: string = DEFAULT_NICHE): string | null {
  const ideas = listIdeas(niche);
  return ideas[0]?.batch_id ?? null;
}
