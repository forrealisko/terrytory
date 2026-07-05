/**
 * Centralized model configuration registry.
 * Used by both the Chat page and Settings page to stay in sync.
 */

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  type: "thinking" | "standard";
  description: string;
}

export const MODELS: ModelConfig[] = [
  // ── Reasoning / Thinking Models ───────────────────────────────────────────
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    type: "thinking",
    description:
      "State-of-the-art open-source reasoning model with native thinking process",
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek R1 (Free)",
    provider: "DeepSeek",
    type: "thinking",
    description: "Free rate-limited tier of DeepSeek R1",
  },
  {
    id: "openai/o1",
    name: "OpenAI o1",
    provider: "OpenAI",
    type: "thinking",
    description:
      "Flagship reasoning model for complex scientific and technical questions",
  },
  {
    id: "openai/o3-mini",
    name: "OpenAI o3-mini",
    provider: "OpenAI",
    type: "thinking",
    description:
      "Fast, cost-efficient reasoning model optimized for coding and math",
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "Anthropic",
    type: "thinking",
    description:
      "State-of-the-art model supporting custom thinking budget allocations",
  },

  // ── Standard Models ───────────────────────────────────────────────────────
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    type: "standard",
    description: "High-speed flagship multimodal model",
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    type: "standard",
    description: "Lightweight and highly responsive model for general tasks",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    type: "standard",
    description:
      "Excellent general capabilities, writing style, and agent behavior",
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    type: "standard",
    description: "Google's flagship model, excellent for multi-turn planning",
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    type: "standard",
    description: "High-speed, high-context multimodal model",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    provider: "Meta",
    type: "standard",
    description: "Top-tier open-source instructions model",
  },
];
