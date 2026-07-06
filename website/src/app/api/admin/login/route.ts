import { NextRequest, NextResponse } from "next/server";

/**
 * Placeholder admin auth. Credentials default to admin / password and can be
 * overridden with ADMIN_USER / ADMIN_PASSWORD env vars. Sets an httpOnly cookie
 * that the proxy checks to gate /admin. Replace with real auth before launch.
 */
export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  const U = process.env.ADMIN_USER || "admin";
  const P = process.env.ADMIN_PASSWORD || "password";

  if (username === U && password === P) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("tt_admin", "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
}
