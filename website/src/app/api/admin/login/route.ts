import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { createSessionToken } from "@/lib/session";

// scrypt (node:crypto) needs the Node runtime.
export const runtime = "nodejs";

const WEEK_SECONDS = 60 * 60 * 24 * 7;

/**
 * Admin login. Verifies credentials against ADMIN_USERS (scrypt-hashed), then
 * mints a signed session cookie the proxy trusts. Closed by default — no
 * configured users means no one can log in.
 */
export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  const user =
    typeof username === "string" && typeof password === "string"
      ? verifyCredentials(username, password)
      : null;

  if (!user) {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken({ u: user, exp: Date.now() + WEEK_SECONDS * 1000 });
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set("tt_admin", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: WEEK_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
