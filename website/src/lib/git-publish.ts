/**
 * Git helpers for publishing. Content lives as JSON in git and Vercel's runtime
 * FS is read-only, so the live site only changes when a commit lands — these
 * make the app do that commit instead of Lukáš doing it by hand.
 *
 * Node runtime only (spawns git).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/** Repo root — the app runs from website/, content lives a level up. */
export function repoRoot(): string {
  const cwd = process.cwd();
  for (const c of [path.resolve(cwd, ".."), cwd]) {
    if (fs.existsSync(path.join(c, ".git"))) return c;
  }
  return path.resolve(cwd, "..");
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf-8", timeout: 60_000 }).trim();
}

export interface PushResult {
  pushed: boolean;
  detail: string;
}

/**
 * Stage ONLY system/content (never sweep up unrelated working-tree WIP), commit
 * and push. Returns why it didn't push rather than throwing — by the time this
 * runs the article is already written locally, so a push failure isn't fatal.
 */
export function commitAndPushContent(subject: string): PushResult {
  const root = repoRoot();
  try {
    git(root, ["add", "system/content"]);
    const staged = git(root, ["diff", "--cached", "--name-only"]);
    if (!staged) return { pushed: false, detail: "No content changes to commit (already up to date)." };
    git(root, ["commit", "-m", subject.slice(0, 72)]);
    git(root, ["push"]);
    return { pushed: true, detail: "Pushed — Vercel is rebuilding (~60-90s)." };
  } catch (err) {
    const msg = (err as Error & { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { pushed: false, detail: `Saved locally, but git push failed: ${msg.slice(0, 300)}` };
  }
}
