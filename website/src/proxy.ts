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
import { verifySessionToken } from "@/lib/session";

// Keep this list in sync with system/niches/*.json ids.
const NICHE_SUBDOMAINS = new Set(["ai", "tech", "travel", "ufo"]);

export async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0];
  const labels = host.split(".");
  const sub = labels.length > 1 ? labels[0] : "";

  const url = req.nextUrl.clone();
  const p = url.pathname;

  // ── Admin auth gate ────────────────────────────────────────────────────
  // Any admin surface requires a *valid* signed session cookie. Verifying the
  // signature (not just presence) is what stops a forged `tt_admin` cookie.
  //
  // The gate must cover /api/* as well as /admin/*: the API is not nested under
  // /admin, so gating by path prefix alone left every route (drafts, settings,
  // publish) readable and writable by anyone on any host that isn't the admin
  // subdomain — which is every host, since the site is served from www.
  //
  // Public by design: the login page and its API (or you could never sign in),
  // and the image endpoint the magazine renders its pictures from.
  const isPublicApi = p.startsWith("/api/admin/") || p.startsWith("/api/content/images/");
  const needsSession = sub === "admin" || p.startsWith("/admin") || (p.startsWith("/api/") && !isPublicApi);

  if (needsSession && p !== "/login") {
    const session = await verifySessionToken(req.cookies.get("tt_admin")?.value);
    if (!session) {
      // Redirecting an API call to an HTML login page just yields a confusing
      // 200 full of markup, so answer those with a plain 401 instead.
      if (p.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
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
