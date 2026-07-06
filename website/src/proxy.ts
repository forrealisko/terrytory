/**
 * Subdomain routing.
 *
 *   ai.terrytory.xyz/*     → /site/ai/*      (public magazine)
 *   tech.terrytory.xyz/*   → /site/tech/*
 *   admin.terrytory.xyz/*  → /admin/*        (private dashboard)
 *
 * The apex domain (terrytory.xyz) serves the public landing hub at /.
 * Image API calls on a niche subdomain get the niche query attached
 * so each magazine serves its own images.
 */
import { NextResponse, type NextRequest } from "next/server";

// Edge runtime can't read the niche configs from disk — keep this list in
// sync with system/niches/*.json ids.
const NICHE_SUBDOMAINS = new Set(["ai", "tech", "travel", "ufo"]);

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0];
  const labels = host.split(".");
  const sub = labels.length > 1 ? labels[0] : "";

  const url = req.nextUrl.clone();
  const p = url.pathname;

  // ── Admin auth gate (placeholder) ──────────────────────────────────────
  // Any admin surface (/admin path or admin subdomain) requires the tt_admin
  // cookie; otherwise redirect to /login. The login page + its API are exempt.
  const isAdminArea = sub === "admin" || p.startsWith("/admin");
  const isAuthRoute = p === "/login" || p.startsWith("/api/admin/");
  if (isAdminArea && !isAuthRoute && !req.cookies.get("tt_admin")) {
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // admin.terrytory.xyz → /admin
  if (sub === "admin") {
    if (p.startsWith("/api/") || p.startsWith("/admin") || p === "/login") {
      return NextResponse.next();
    }
    url.pathname = `/admin${p === "/" ? "" : p}`;
    return NextResponse.rewrite(url);
  }

  if (!NICHE_SUBDOMAINS.has(sub)) return NextResponse.next();

  if (url.pathname.startsWith("/api/")) {
    // Scope image requests to the subdomain's niche.
    if (url.pathname.startsWith("/api/content/images/")) {
      url.searchParams.set("niche", sub);
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Already-prefixed paths (e.g. sibling-site links) pass through untouched.
  if (url.pathname.startsWith("/site/")) return NextResponse.next();

  url.pathname = `/site/${sub}${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
