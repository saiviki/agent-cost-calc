export type Model = {
  id: string;
  name: string;
  provider: string;
  inputPricePerM: number;   // $ per 1M input tokens
  outputPricePerM: number;  // $ per 1M output tokens
  cacheReadPricePerM?: number;  // $ per 1M cached read tokens
  cacheWritePricePerM?: number; // $ per 1M cache write tokens (5-min TTL)
  supportsCache: boolean;
};

// Pricing verified 2026-05-09 against:
// - Anthropic: docs.claude.com/en/docs/about-claude/models/overview
// - Google:    ai.google.dev/gemini-api/docs/pricing
// - OpenAI:    helicone.ai/llm-cost (OpenAI page blocks scraping)
//
// Anthropic prompt-caching: cache_read = 0.1 × input, cache_write_5min = 1.25 × input.
// OpenAI cached input: GPT-5 family = 0.1 × input, GPT-4.1 = 0.25 × input, GPT-4o = 0.5 × input.
// Gemini 2.5 Pro pricing shown is the ≤200k-token tier (>200k doubles).
export const MODELS: Model[] = [
  // ── Anthropic ──
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    inputPricePerM: 5.0,
    outputPricePerM: 25.0,
    cacheReadPricePerM: 0.50,
    cacheWritePricePerM: 6.25,
    supportsCache: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    inputPricePerM: 3.0,
    outputPricePerM: 15.0,
    cacheReadPricePerM: 0.30,
    cacheWritePricePerM: 3.75,
    supportsCache: true,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    inputPricePerM: 1.0,
    outputPricePerM: 5.0,
    cacheReadPricePerM: 0.10,
    cacheWritePricePerM: 1.25,
    supportsCache: true,
  },
  // ── OpenAI ──
  {
    id: "gpt-5",
    name: "GPT-5",
    provider: "OpenAI",
    inputPricePerM: 1.25,
    outputPricePerM: 10.0,
    cacheReadPricePerM: 0.125,
    supportsCache: true,
  },
  {
    id: "gpt-5-mini",
    name: "GPT-5 mini",
    provider: "OpenAI",
    inputPricePerM: 0.25,
    outputPricePerM: 2.0,
    cacheReadPricePerM: 0.025,
    supportsCache: true,
  },
  {
    id: "gpt-5-nano",
    name: "GPT-5 nano",
    provider: "OpenAI",
    inputPricePerM: 0.05,
    outputPricePerM: 0.40,
    cacheReadPricePerM: 0.005,
    supportsCache: true,
  },
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "OpenAI",
    inputPricePerM: 2.0,
    outputPricePerM: 8.0,
    cacheReadPricePerM: 0.50,
    supportsCache: true,
  },
  // ── Google ──
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    inputPricePerM: 1.25,
    outputPricePerM: 10.0,
    cacheReadPricePerM: 0.125,
    supportsCache: true,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    inputPricePerM: 0.30,
    outputPricePerM: 2.50,
    cacheReadPricePerM: 0.03,
    supportsCache: true,
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash-Lite",
    provider: "Google",
    inputPricePerM: 0.10,
    outputPricePerM: 0.40,
    cacheReadPricePerM: 0.01,
    supportsCache: true,
  },
];

export type AgentConfig = {
  modelId: string;
  systemPromptTokens: number;   // large context, usually cached
  inputTokensPerRun: number;    // user input + retrieved context
  outputTokensPerRun: number;
  toolCallsPerRun: number;      // each tool call = extra input/output round
  tokensPerToolCall: number;    // avg tokens in tool call input+output
  cacheHitRate: number;         // 0–1, fraction of input served from cache
  runsPerDay: number;
};

export type CostBreakdown = {
  inputCost: number;
  cachedInputCost: number;
  cacheWriteCost: number;
  outputCost: number;
  toolCallCost: number;
  totalPerRun: number;
  totalPerDay: number;
  totalPerMonth: number;
};

export function calculateCost(config: AgentConfig): CostBreakdown {
  const model = MODELS.find((m) => m.id === config.modelId);
  if (!model) throw new Error("Model not found");

  const totalInput = config.systemPromptTokens + config.inputTokensPerRun;

  // Cached vs uncached input
  const cachedTokens = model.supportsCache
    ? totalInput * config.cacheHitRate
    : 0;
  const uncachedTokens = totalInput - cachedTokens;

  const inputCost = (uncachedTokens / 1_000_000) * model.inputPricePerM;
  const cachedInputCost = model.cacheReadPricePerM
    ? (cachedTokens / 1_000_000) * model.cacheReadPricePerM
    : 0;
  const cacheWriteCost = model.cacheWritePricePerM && config.cacheHitRate < 1
    ? (config.systemPromptTokens / 1_000_000) * model.cacheWritePricePerM * (1 - config.cacheHitRate)
    : 0;

  const outputCost =
    (config.outputTokensPerRun / 1_000_000) * model.outputPricePerM;

  // Tool calls: each call sends + receives tokens
  const toolCallCost =
    (config.toolCallsPerRun * config.tokensPerToolCall) / 1_000_000 *
    ((model.inputPricePerM + model.outputPricePerM) / 2);

  const totalPerRun = inputCost + cachedInputCost + cacheWriteCost + outputCost + toolCallCost;
  const totalPerDay = totalPerRun * config.runsPerDay;
  const totalPerMonth = totalPerDay * 30;

  return {
    inputCost,
    cachedInputCost,
    cacheWriteCost,
    outputCost,
    toolCallCost,
    totalPerRun,
    totalPerDay,
    totalPerMonth,
  };
}

export function formatCost(value: number): string {
  if (value < 0.001) return `$${(value * 1000).toFixed(4)}m`;
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 10) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
