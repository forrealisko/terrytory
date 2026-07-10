/**
 * Admin credential verification (Node runtime only — uses node:crypto scrypt).
 *
 * Users live in the ADMIN_USERS env var, one per line (or comma/semicolon
 * separated), each `username:saltHex:hashHex`. Passwords are never stored in
 * plaintext — `hash = scrypt(password, salt, 32)`. Generate lines with:
 *
 *   node system/scripts/hash-password.mjs <username> <password>
 *
 * Closed by default: with no ADMIN_USERS (and no explicit ADMIN_USER +
 * ADMIN_PASSWORD pair) configured, every login is denied. There is no default
 * password and no public registration — the gate is invite-only.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export interface AdminUser {
  username: string;
  salt: string;
  hash: string;
}

const KEYLEN = 32;

export function getUsers(): AdminUser[] {
  const raw = process.env.ADMIN_USERS;
  if (!raw) return [];
  const users: AdminUser[] = [];
  for (const line of raw.split(/[\n,;]+/)) {
    const t = line.trim();
    if (!t) continue;
    const [username, salt, hash] = t.split(":");
    if (username && salt && hash) users.push({ username, salt, hash });
  }
  return users;
}

/** Constant-time password check. Returns the matched username, or null. */
export function verifyCredentials(username: string, password: string): string | null {
  const users = getUsers();

  if (users.length) {
    const u = users.find((x) => x.username === username);
    if (!u) return null;
    let expected: Buffer;
    try {
      expected = Buffer.from(u.hash, "hex");
    } catch {
      return null;
    }
    const derived = scryptSync(password, u.salt, expected.length || KEYLEN);
    if (derived.length !== expected.length) return null;
    return timingSafeEqual(derived, expected) ? u.username : null;
  }

  // Optional single-pair override — ONLY if both are explicitly set. No
  // default credentials: with nothing configured, every login is denied.
  // This is what makes the gate closed-by-default (no admin/password backdoor).
  const U = process.env.ADMIN_USER;
  const P = process.env.ADMIN_PASSWORD;
  if (U && P) return username === U && password === P ? U : null;

  return null;
}

/** Generate a fresh salt+hash for a password (used by the CLI script). */
export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEYLEN).toString("hex");
  return { salt, hash };
}
