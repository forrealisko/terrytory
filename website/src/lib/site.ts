/**
 * Helpers for the public magazine at /site/[niche] (served on <niche>.terrytory.xyz).
 *
 * Link base: on a real niche subdomain the proxy maps the magazine to root ("/"),
 * so internal links are bare ("/", "/<slug>"). In local/path mode (localhost/apex
 * hitting /site/<niche>) links must carry the "/site/<niche>" prefix.
 */
import { headers } from "next/headers";
import { getNiche, listNicheIds } from "./niches";

export function isValidNiche(id: string): boolean {
  return listNicheIds().includes(id);
}

export async function magBasePath(niche: string): Promise<string> {
  const h = await headers();
  const host = (h.get("host") || "").split(":")[0];
  const sub = host.split(".")[0];
  return sub === niche ? "" : `/site/${niche}`;
}

export function nicheBrand(niche: string) {
  const n = getNiche(niche);
  return {
    id: niche,
    name: n.brand?.name || "TERRYTORY",
    shortName: n.brand?.shortName || niche,
    tagline: n.brand?.tagline || "",
    accent: n.brand?.accent || "#b8623a",
    heroTitle: n.brand?.hero_title || n.brand?.name || "TERRYTORY",
    heroSubtitle: n.brand?.hero_subtitle || n.brand?.tagline || "",
  };
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
