/**
 * POST /api/ai
 * Proxies requests to OpenRouter's chat completions API.
 * Keeps the API key server-side for security.
 *
 * Body: {
 *   model: string,
 *   messages: Array<{role, content}>,
 *   includeScrapedContext?: boolean,
 *   ...options
 * }
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { SCRAPER_PATHS, SourceId } from "@/lib/scraper-paths";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface Headline {
  type: string;
  title: string;
  url: string;
  article_date?: string | null;
  article_date_raw?: string | null;
  author?: string | null;
  excerpt?: string | null;
  first_seen: string;
}

interface ScrapePayload {
  meta: {
    scraped_at: string;
    total_headlines: number;
  };
  headlines: Headline[];
}

function readSource(sourceId: SourceId): { data: ScrapePayload | null } {
  const source = SCRAPER_PATHS.sources[sourceId];
  try {
    if (!fs.existsSync(source.latest)) {
      console.error(`[AI Route] File does not exist: ${source.latest}`);
      return { data: null };
    }
    const raw = fs.readFileSync(source.latest, "utf-8");
    return { data: JSON.parse(raw) };
  } catch (err) {
    console.error(
      `[AI Route] Failed to read source ${sourceId} from path: ${source.latest}`,
      err
    );
    return { data: null };
  }
}

function getScrapedArticlesContext(): string {
  const sourceIds = Object.keys(SCRAPER_PATHS.sources) as SourceId[];
  const allHeadlines: Array<Headline & { _source_name: string }> = [];

  for (const id of sourceIds) {
    const result = readSource(id);
    if (result.data) {
      const sourceName = SCRAPER_PATHS.sources[id].name;
      for (const h of result.data.headlines) {
        allHeadlines.push({
          ...h,
          _source_name: sourceName,
        });
      }
    }
  }

  // Sort by first_seen descending, take top 80 latest articles to stay safe within prompt sizes
  const sorted = allHeadlines
    .sort(
      (a, b) =>
        new Date(b.first_seen || 0).getTime() -
        new Date(a.first_seen || 0).getTime()
    )
    .slice(0, 80);

  let context =
    "Here is the context of recent scraped UFO/UAP articles from active intelligence feeds:\n\n";

  for (const h of sorted) {
    const date = h.article_date || h.article_date_raw || "Unknown Date";
    context += `- [${h._source_name}] Title: "${h.title}"\n  Date: ${date}\n  URL: ${h.url}\n`;
    if (h.excerpt) {
      context += `  Summary: ${h.excerpt.trim()}\n`;
    }
    context += "\n";
  }

  console.log(
    `[AI Route] Built scraped context: ${sorted.length} articles, ${context.length} chars`
  );

  return context;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenRouter API key not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { model, messages, includeScrapedContext, ...restOptions } = body;

    let finalMessages = [...(messages || [])];

    if (includeScrapedContext) {
      const context = getScrapedArticlesContext();
      const systemMessage = {
        role: "system",
        content: `You are Terrytory AI, a highly sophisticated UAP intelligence analyst assistant.
You have access to the latest scraped news headlines and summaries from primary monitoring channels (The Black Vault, Liberation Times, and The Debrief).

${context}

Use these articles as your factual grounding when answering queries. If the user asks about recent developments, files, releases, or news, synthesize this data. Always provide the URL references to the articles when citing them using standard markdown link syntax (e.g. [Title](URL)). Keep your tone professional, analytical, and objective.`,
      };

      // Add system message to the beginning
      finalMessages = [systemMessage, ...finalMessages];
    }

    // Build the payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      model: model || "openai/gpt-4o-mini",
      messages: finalMessages,
      ...restOptions,
    };

    // ── Reasoning model parameter adjustments ───────────────────────────────

    // Anthropic Claude 3.7 Sonnet: enable thinking with a budget
    if (
      payload.model === "anthropic/claude-3.7-sonnet" &&
      !payload.thinking
    ) {
      payload.thinking = {
        type: "enabled",
        budget_tokens: 2048,
      };
      // Claude 3.7 requires a large max_tokens ceiling when thinking is enabled
      if (!payload.max_tokens || payload.max_tokens < 4096) {
        payload.max_tokens = 4096;
      }
    }

    // OpenAI reasoning models (o1, o3-mini): use max_completion_tokens instead of max_tokens
    if (
      payload.model.includes("openai/o1") ||
      payload.model.includes("openai/o3-mini")
    ) {
      if (payload.max_tokens) {
        payload.max_completion_tokens = payload.max_tokens;
        delete payload.max_tokens;
      }
    }

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://sys.terrytory.com",
        "X-Title": "Terrytory System Dashboard",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || "OpenRouter request failed",
          details: data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `AI proxy error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
