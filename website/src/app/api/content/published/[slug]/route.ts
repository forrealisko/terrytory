/**
 * PATCH  /api/content/published/[slug]  — edit, or toggle the feature flag
 * DELETE /api/content/published/[slug]  — archive (reversible; not a delete)
 *
 * Both write through the article store, so on Vercel they land as commits to
 * the repo and go live on the next deploy. Sitting behind the proxy's session
 * gate, so no auth check here.
 */
import { NextRequest, NextResponse } from "next/server";
import { archivePublished, setFeatured, updatePublished } from "@/lib/article-store";
import { ContentWriteError, canWriteFiles, isGitHubWriteConfigured } from "@/lib/content-writer";
import { resolveNiche } from "@/lib/niches";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/** Saving on a read-only deploy without a token can't work — say so up front. */
function writeUnavailable(): NextResponse | null {
  if (canWriteFiles() || isGitHubWriteConfigured()) return null;
  return NextResponse.json(
    {
      error:
        "This deployment can't save changes. Its filesystem is read-only and GITHUB_TOKEN isn't set — add a fine-grained token with Contents: read & write to the Vercel environment.",
    },
    { status: 501 }
  );
}

function failed(err: unknown) {
  const message = err instanceof ContentWriteError ? err.message : (err as Error).message;
  return NextResponse.json({ error: message }, { status: 502 });
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const blocked = writeUnavailable();
  if (blocked) return blocked;

  const { slug } = await params;
  const niche = resolveNiche(req);

  let body: { featured?: boolean } & Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  try {
    // A featured-only body is the common case (one toggle, one commit); anything
    // else is treated as a content edit.
    const keys = Object.keys(body);
    const article =
      keys.length === 1 && keys[0] === "featured"
        ? await setFeatured(slug, !!body.featured, niche)
        : await updatePublished(slug, body, niche);

    if (!article) return NextResponse.json({ error: `No published article "${slug}"` }, { status: 404 });
    return NextResponse.json({ ok: true, article, pending: !canWriteFiles() });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const blocked = writeUnavailable();
  if (blocked) return blocked;

  const { slug } = await params;
  const niche = resolveNiche(req);

  try {
    const article = await archivePublished(slug, niche);
    if (!article) return NextResponse.json({ error: `No published article "${slug}"` }, { status: 404 });
    return NextResponse.json({ ok: true, article, pending: !canWriteFiles() });
  } catch (err) {
    return failed(err);
  }
}
