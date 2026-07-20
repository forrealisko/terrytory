/**
 * Traffic analytics for the public magazine.
 *
 * Provider-agnostic on purpose: pick one by setting its env var and redeploy,
 * switch later without touching code. Nothing renders when nothing is
 * configured, so this is inert until you opt in.
 *
 *   Plausible  NEXT_PUBLIC_PLAUSIBLE_DOMAIN=terrytory.xyz
 *              (paid, ~EUR 9/mo, no cookie banner needed in the EU)
 *
 *   Umami      NEXT_PUBLIC_UMAMI_ID=<website-id>
 *              NEXT_PUBLIC_UMAMI_SRC=https://cloud.umami.is/script.js
 *              (free tier, self-hostable later on your own server)
 *
 *   GA4        NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
 *              (free, but sets cookies — you need a consent banner in the EU)
 *
 * Recommendation for this project: Umami. Free at your traffic, no cookie
 * banner, and it moves onto your own VPS for nothing once you migrate.
 *
 * Loaded with strategy="afterInteractive" so measurement never blocks paint.
 * Admin pages don't render this — your own clicks are not traffic.
 */
import Script from "next/script";

export function Analytics() {
  const plausible = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const umamiId = process.env.NEXT_PUBLIC_UMAMI_ID;
  const umamiSrc = process.env.NEXT_PUBLIC_UMAMI_SRC || "https://cloud.umami.is/script.js";
  const ga = process.env.NEXT_PUBLIC_GA_ID;

  return (
    <>
      {plausible && (
        <Script
          defer
          data-domain={plausible}
          src="https://plausible.io/js/script.js"
          strategy="afterInteractive"
        />
      )}

      {umamiId && (
        <Script defer src={umamiSrc} data-website-id={umamiId} strategy="afterInteractive" />
      )}

      {ga && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}');`}
          </Script>
        </>
      )}
    </>
  );
}
