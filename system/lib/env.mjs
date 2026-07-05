/**
 * Shared environment loader for all system scripts.
 * Reads system/.env and website/.env.local into process.env
 * (existing process.env values always win).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_ROOT = path.resolve(__dirname, "..");

const ENV_FILES = [
  path.join(SYSTEM_ROOT, ".env"),
  path.resolve(SYSTEM_ROOT, "..", "website", ".env.local"),
];

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  for (const file of ENV_FILES) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

/** Returns proxy settings, or null when disabled/unconfigured. */
export function getProxy() {
  loadEnv();
  if (process.env.PROXY_ENABLED !== "true") return null;
  const host = process.env.BRIGHTDATA_HOST;
  const port = process.env.BRIGHTDATA_PORT;
  const username = process.env.BRIGHTDATA_USER;
  const password = process.env.BRIGHTDATA_PASS;
  if (!host || !port || !username || !password) return null;
  return {
    server: `http://${host}:${port}`,
    host,
    port: Number(port),
    username,
    password,
  };
}

export function getOpenRouterKey() {
  loadEnv();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured (website/.env.local or system/.env).");
  return key;
}
