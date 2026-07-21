/**
 * POST /api/content/ai-edit — the editor's command bar.
 *
 * Takes a plain-English instruction ("add an image slot at the bottom and write
 * its prompt from the text above it", "tighten the intro", "make the headline
 * punchier") plus the current article, and returns only the fields that should
 * change, so the review page can apply them for the editor to eyeball before
 * saving. Nothing is persisted here — it just proposes the edit.
 *
 * Image slots are [IMAGE #IMGn: prompt] tokens in the body, mirrored by a slots
 * array; the model edits both together so an added token always has a matching
 * slot with a real prompt.
 *
 * The response is a line/delimiter format, NOT one big JSON blob: an article
 * body is full of quotes and newlines, and models routinely botch escaping it
 * inside a JSON string (observed live: `("Full Self-Driving")` broke the JSON).
 * The body comes back raw between markers instead, which can't be mis-escaped.
 *
 * Behind the proxy's session gate. One LLM call per command — user-triggered,
 * not bulk, so a capable model is worth it for reliable instruction-following.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const EDIT_MODEL = process.env.AI_EDIT_MODEL || "anthropic/claude-sonnet-4.6";

interface Slot {
  id?: string;
  description?: string;
}

const SYSTEM = `You are a precise copy editor operating on ONE article through a command bar. The editor gives an instruction; you make a minimal, exact edit and report only what changed.

The article has these parts:
- headline: the title
- excerpt: a short summary (keep under 155 characters)
- body_markdown: the article body in markdown
- image slots: placeholders written in the body as tokens [IMAGE #IMGn: prompt text] where n is a number. Each token mirrors an entry in "slots": {"id":"IMGn","description":"prompt text"}. The description IS the image-generation prompt.

RULES
- Change ONLY what the instruction asks for. Report only the fields you changed.
- To ADD an image slot: pick the next unused IMGn id, insert the token [IMAGE #IMGn: <prompt>] in the body at the requested position (on its own line, blank line above and below), and include the full new slots list. Write the prompt from the surrounding text unless told otherwise — concrete, visual, no text/watermarks.
- To REMOVE a slot: delete its token from the body and omit it from the slots list.
- Never invent or renumber existing IMG ids. Never touch tokens you weren't asked to.
- Keep the article's existing voice. Do NOT add em dashes, semicolons, or "not just X but Y" phrasing.
- If the instruction is unclear or would harm the article, change nothing and say why in SUMMARY.

RESPOND IN EXACTLY THIS FORMAT (omit any line for a field you did not change):
SUMMARY: <one sentence describing what you changed, or why nothing changed>
HEADLINE: <new headline>
EXCERPT: <new excerpt>
SLOTS: <single-line JSON array of {"id","description"} for ALL slots after the edit>
BODY:
<<<START>>>
<the full new body markdown, raw>
<<<END>>>`;

function pickLine(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY is not set" }, { status: 501 });
  }

  let body: {
    instruction?: string;
    article?: { headline?: string; excerpt?: string; body_markdown?: string; slots?: Slot[] };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const instruction = (body.instruction || "").trim();
  const article = body.article || {};
  if (!instruction) return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  if (instruction.length > 2000) {
    return NextResponse.json({ error: "instruction too long" }, { status: 400 });
  }

  const slots = (article.slots || []).map((s) => ({ id: s.id, description: s.description }));
  const userMsg = `INSTRUCTION:\n${instruction}\n\nCURRENT ARTICLE:\nheadline: ${JSON.stringify(
    article.headline || ""
  )}\nexcerpt: ${JSON.stringify(article.excerpt || "")}\nslots: ${JSON.stringify(
    slots
  )}\n\nbody_markdown:\n${article.body_markdown || ""}`;

  let data: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://terrytory.xyz",
        "X-Title": "Terrytory AI Edit",
      },
      body: JSON.stringify({
        model: EDIT_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error?.message || `Model error (${res.status})` },
        { status: 502 }
      );
    }
  } catch (err) {
    const msg = (err as Error).name === "AbortError" ? "Edit timed out" : (err as Error).message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const raw = data.choices?.[0]?.message?.content || "";
  const changes: Record<string, unknown> = {};

  const headline = pickLine(raw, "HEADLINE");
  if (headline) changes.headline = headline;
  const excerpt = pickLine(raw, "EXCERPT");
  if (excerpt) changes.excerpt = excerpt;

  const slotsLine = pickLine(raw, "SLOTS");
  if (slotsLine) {
    try {
      const arr = JSON.parse(slotsLine);
      if (Array.isArray(arr)) {
        changes.slots = arr
          .filter((s) => s && typeof s.id === "string")
          .map((s) => ({ id: s.id, description: String(s.description || "") }));
      }
    } catch {
      /* leave slots unchanged if the one JSON line is malformed */
    }
  }

  // Body comes back raw between markers — never JSON-escaped.
  const bodyMatch = raw.match(/<<<START>>>\r?\n([\s\S]*?)\r?\n<<<END>>>/);
  if (bodyMatch) {
    const newBody = bodyMatch[1].trim();
    if (newBody) changes.body_markdown = newBody;
  }

  const summary = pickLine(raw, "SUMMARY") || "Done.";

  if (!Object.keys(changes).length) {
    return NextResponse.json({ summary, changes: {}, changed: [] });
  }

  return NextResponse.json({ summary, changes, changed: Object.keys(changes) });
}
