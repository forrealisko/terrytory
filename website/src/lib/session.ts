/**
 * Signed session tokens (stateless, cookie-based).
 *
 * A token is `base64url(payload).base64url(hmac)` where the HMAC-SHA256 is
 * computed over the payload with SESSION_SECRET. No server-side store — the
 * signature proves the cookie was minted by us and hasn't been tampered with.
 *
 * Uses Web Crypto (globalThis.crypto.subtle) so the *same* module verifies
 * tokens in both the proxy (runs before render) and Node route handlers.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface Session {
  /** username */
  u: string;
  /** expiry, epoch ms */
  exp: number;
}

/** Read the signing secret. A loud dev fallback keeps local dev working. */
export function sessionSecret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(session: Session, secret = sessionSecret()): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(session)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Verify signature + expiry. Returns the session or null if invalid/expired. */
export async function verifySessionToken(
  token: string | undefined | null,
  secret = sessionSecret(),
): Promise<Session | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;

  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(sig), enc.encode(payload));
    if (!ok) return null;
    const session = JSON.parse(dec.decode(b64urlDecode(payload))) as Session;
    if (!session.u || !session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}
