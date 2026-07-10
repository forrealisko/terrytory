#!/usr/bin/env node
/**
 * Generate an ADMIN_USERS line for a teammate.
 *
 *   node system/scripts/hash-password.mjs <username> <password>
 *
 * Prints `username:saltHex:hashHex`. Paste it (one user per line) into the
 * ADMIN_USERS env var — locally in website/.env.local, or in Vercel's project
 * env settings. The plaintext password is never stored; only the scrypt hash is.
 */
import { scryptSync, randomBytes } from "node:crypto";

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Usage: node system/scripts/hash-password.mjs <username> <password>");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 32).toString("hex");

console.log(`${username}:${salt}:${hash}`);
