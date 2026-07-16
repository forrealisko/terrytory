/**
 * Writing content from the admin, in both places it runs.
 *
 * Content lives as JSON files in the repo and the live site serves them from
 * there, so "save" has to mean "change the repo". How depends on where we are:
 *
 *   local (npm run dev)  → write the file. Instant. You commit it like anything else.
 *   Vercel (serverless)  → the filesystem is read-only, so commit via the GitHub
 *                          API. The push triggers a redeploy and the change is
 *                          live in a minute or two.
 *
 * This is the same move the rest of the system already makes — the scrape and
 * publish workflows both commit their output back to the repo. The admin was
 * the only part that couldn't, which is why publishing had to be routed through
 * a scheduled Action instead of just happening.
 *
 * Requires in the Vercel environment:
 *   GITHUB_TOKEN  — a fine-grained PAT with Contents: read & write on this repo
 *   GITHUB_REPO   — "owner/name" (defaults to forrealisko/terrytory)
 *   GITHUB_BRANCH — defaults to main
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://api.github.com";
const REPO = process.env.GITHUB_REPO || "forrealisko/terrytory";
const BRANCH = process.env.GITHUB_BRANCH || "main";

export class ContentWriteError extends Error {}

/** Repo-relative path ("system/content/...") for a path under SYSTEM_ROOT. */
export function repoRelative(absolute: string): string {
  const root = path.join(process.cwd(), "..");
  const rel = path.relative(root, absolute);
  if (rel.startsWith("..")) {
    throw new ContentWriteError(`Refusing to write outside the repo: ${absolute}`);
  }
  return rel.split(path.sep).join("/");
}

/**
 * Can we write files directly? True locally, false on Vercel.
 *
 * Probed rather than inferred from NODE_ENV, because `next start` on a writable
 * box is production too — the thing that matters is the filesystem, not the
 * build mode.
 */
export function canWriteFiles(): boolean {
  if (process.env.FORCE_GITHUB_WRITES === "1") return false;
  try {
    const probe = path.join(process.cwd(), "..", "system", "content");
    fs.accessSync(probe, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function isGitHubWriteConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

async function gh(url: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new ContentWriteError(
      "This deployment cannot save changes: GITHUB_TOKEN is not set. Add a fine-grained token with Contents: read & write to the Vercel environment."
    );
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  return res;
}

/** Current blob SHA for a path, or null if it doesn't exist. */
async function shaFor(repoPath: string): Promise<string | null> {
  const res = await gh(
    `${API}/repos/${REPO}/contents/${encodeURI(repoPath)}?ref=${encodeURIComponent(BRANCH)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ContentWriteError(`GitHub read failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { sha?: string };
  return body.sha ?? null;
}

async function putFile(repoPath: string, contents: string, message: string) {
  const sha = await shaFor(repoPath);
  const res = await gh(`${API}/repos/${REPO}/contents/${encodeURI(repoPath)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(contents, "utf8").toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new ContentWriteError(`GitHub write failed (${res.status}): ${await res.text()}`);
  }
}

async function removeFile(repoPath: string, message: string) {
  const sha = await shaFor(repoPath);
  if (!sha) return; // already gone
  const res = await gh(`${API}/repos/${REPO}/contents/${encodeURI(repoPath)}`, {
    method: "DELETE",
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
  if (!res.ok) {
    throw new ContentWriteError(`GitHub delete failed (${res.status}): ${await res.text()}`);
  }
}

/** Write (or overwrite) a JSON file. */
export async function writeJson(absolute: string, data: unknown, message: string): Promise<void> {
  const contents = JSON.stringify(data, null, 2);
  if (canWriteFiles()) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);
    return;
  }
  await putFile(repoRelative(absolute), contents, message);
}

/** Delete a file. */
export async function deleteFile(absolute: string, message: string): Promise<void> {
  if (canWriteFiles()) {
    try {
      fs.unlinkSync(absolute);
    } catch {
      /* already gone */
    }
    return;
  }
  await removeFile(repoRelative(absolute), message);
}

/**
 * Move a JSON file, writing the destination before removing the source.
 *
 * Over the GitHub API this is two commits, so the order matters: if the second
 * fails the file exists in both places, which a re-run reconciles. The other
 * order would lose it outright.
 */
export async function moveJson(
  fromAbsolute: string,
  toAbsolute: string,
  data: unknown,
  message: string
): Promise<void> {
  await writeJson(toAbsolute, data, message);
  await deleteFile(fromAbsolute, message);
}
