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

  // Tables first — a header row, a |---|---| separator, then body rows. Emitted
  // as full <table> HTML so the paragraph splitter leaves them alone.
  html = renderTables(html);

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

  // Ordered lists (1. 2. 3.) → <ol>, before unordered so the two don't collide.
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, "<oli>$1</oli>");
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (m) => `<ol>${m.replace(/<oli>/g, "<li>").replace(/<\/oli>/g, "</li>")}</ol>`);

  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  const parts = html.split(
    /(<pre[\s\S]*?<\/pre>|<table[\s\S]*?<\/table>|<h[1-3][\s\S]*?<\/h[1-3]>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<figure[\s\S]*?<\/figure>|<blockquote>[\s\S]*?<\/blockquote>)/
  );
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (
      !p.startsWith("<pre") &&
      !p.startsWith("<table") &&
      !p.startsWith("<h") &&
      !p.startsWith("<ul") &&
      !p.startsWith("<ol") &&
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

/**
 * Convert GitHub-style Markdown tables to HTML. Scans line-by-line for a
 * header row immediately followed by a |---|:--:|---| separator, then any
 * number of body rows. Cell inline formatting (bold/links) is applied by the
 * later passes since this only emits the table scaffold.
 */
function renderTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  const isRow = (l: string) => /^\s*\|(.+)\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(l);
  const cells = (l: string) =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = cells(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i]) && !isSep(lines[i])) {
        rows.push(cells(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      out.push(`<div class="mag-table-wrap"><table class="mag-table">${thead}${tbody}</table></div>`);
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
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
