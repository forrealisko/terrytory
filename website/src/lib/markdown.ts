/**
 * Markdown → HTML renderer shared by the public magazine and the blog.
 * Deliberately small: headings, bold/em, lists, links, code, images.
 * `niche` scopes internal image API URLs so each magazine serves its own files.
 */
export function renderMarkdown(text: string, niche?: string): string {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<figure class="mag-figure"><img src="$2" alt="$1" loading="lazy" /><figcaption>$1</figcaption></figure>'
  );

  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");

  html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  const parts = html.split(
    /(<pre[\s\S]*?<\/pre>|<h[1-3][\s\S]*?<\/h[1-3]>|<ul>[\s\S]*?<\/ul>|<figure[\s\S]*?<\/figure>|<blockquote>[\s\S]*?<\/blockquote>)/
  );
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (
      !p.startsWith("<pre") &&
      !p.startsWith("<h") &&
      !p.startsWith("<ul") &&
      !p.startsWith("<figure") &&
      !p.startsWith("<blockquote")
    ) {
      parts[i] = p
        .split(/\n\n+/)
        .map((para) => (para.trim() ? `<p>${para.replace(/\n/g, "<br/>")}</p>` : ""))
        .join("");
    }
  }
  html = parts.join("");

  if (niche) html = withNicheImages(html, niche);
  return html;
}

/** Append ?niche= to internal image API URLs so the right niche's files load. */
export function withNicheImages(html: string, niche: string): string {
  return html.replace(
    /(src=")(\/api\/content\/images\/[^"?]+)(")/g,
    `$1$2?niche=${niche}$3`
  );
}

/** Same for a single URL (hero images etc.). */
export function nicheImageUrl(url: string | undefined | null, niche: string): string | null {
  if (!url) return null;
  if (!url.startsWith("/api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}niche=${niche}`;
}

export function wordCount(text: string): number {
  return text
    .replace(/[#*_\[\]()>`-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function readTimeMin(text: string): number {
  return Math.max(1, Math.ceil(wordCount(text) / 250));
}
