export type Tier = "frontier" | "mid" | "budget";
export type Strength =
  | "coding"
  | "reasoning"
  | "multimodal"
  | "long-context"
  | "fast"
  | "general";

export type Model = {
  id: string;
  name: string;
  provider: string;
  isOpen: boolean;            // open-weights or open-API
  tier: Tier;
  strengths: Strength[];
  contextK: number;            // context window in K tokens
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
};

// Pricing verified 2026-05-09 against OpenRouter's unified pricing API
// (openrouter.ai/api/v1/models — ground-truth across 100+ providers)
// + Anthropic docs.claude.com + Google ai.google.dev.
//
// Lineup is curated from OpenRouter's real-usage top-20 (production traffic)
// + Artificial Analysis intelligence index, NOT just "newest."
//
// Anthropic prompt-caching: cache_read = 0.1 × input, cache_write_5min = 1.25 × input.
// OpenAI cached input: GPT-5.x family ≈ 0.1 × input.
// Open-model cache pricing varies by host (figures here = OpenRouter median).
export const MODELS: Model[] = [
  // ── FRONTIER ──
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    provider: "Anthropic",
    isOpen: false,
    tier: "frontier",
    strengths: ["coding", "reasoning"],
    contextK: 1000,
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
    isOpen: false,
    tier: "frontier",
    strengths: ["coding", "general"],
    contextK: 1000,
    inputPricePerM: 3.0,
    outputPricePerM: 15.0,
    cacheReadPricePerM: 0.30,
    cacheWritePricePerM: 3.75,
    supportsCache: true,
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "OpenAI",
    isOpen: false,
    tier: "frontier",
    strengths: ["reasoning"],
    contextK: 1050,
    inputPricePerM: 5.0,
    outputPricePerM: 30.0,
    cacheReadPricePerM: 0.50,
    supportsCache: true,
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    isOpen: false,
    tier: "frontier",
    strengths: ["multimodal", "long-context", "reasoning"],
    contextK: 1048,
    inputPricePerM: 2.0,
    outputPricePerM: 12.0,
    cacheReadPricePerM: 0.20,
    supportsCache: true,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    isOpen: true,
    tier: "frontier",
    strengths: ["reasoning", "coding"],
    contextK: 1048,
    inputPricePerM: 0.435,
    outputPricePerM: 0.870,
    cacheReadPricePerM: 0.0036,
    supportsCache: true,
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "Moonshot",
    isOpen: true,
    tier: "frontier",
    strengths: ["reasoning", "long-context"],
    contextK: 262,
    inputPricePerM: 0.75,
    outputPricePerM: 3.50,
    cacheReadPricePerM: 0.15,
    supportsCache: true,
  },
  // ── MID ──
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "Anthropic",
    isOpen: false,
    tier: "mid",
    strengths: ["fast", "coding"],
    contextK: 200,
    inputPricePerM: 1.0,
    outputPricePerM: 5.0,
    cacheReadPricePerM: 0.10,
    cacheWritePricePerM: 1.25,
    supportsCache: true,
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    provider: "OpenAI",
    isOpen: false,
    tier: "mid",
    strengths: ["fast", "general"],
    contextK: 400,
    inputPricePerM: 0.75,
    outputPricePerM: 4.50,
    cacheReadPricePerM: 0.075,
    supportsCache: true,
  },
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash",
    provider: "Google",
    isOpen: false,
    tier: "mid",
    strengths: ["multimodal", "fast", "long-context"],
    contextK: 1048,
    inputPricePerM: 0.50,
    outputPricePerM: 3.0,
    cacheReadPricePerM: 0.05,
    supportsCache: true,
  },
  {
    id: "grok-4.1-fast",
    name: "Grok 4.1 Fast",
    provider: "xAI",
    isOpen: false,
    tier: "mid",
    strengths: ["long-context", "fast"],
    contextK: 2000,
    inputPricePerM: 0.20,
    outputPricePerM: 0.50,
    cacheReadPricePerM: 0.05,
    supportsCache: true,
  },
  {
    id: "qwen-3.6-plus",
    name: "Qwen 3.6 Plus",
    provider: "Alibaba",
    isOpen: true,
    tier: "mid",
    strengths: ["coding", "general"],
    contextK: 1000,
    inputPricePerM: 0.325,
    outputPricePerM: 1.95,
    supportsCache: false,
  },
  // ── BUDGET ──
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    isOpen: true,
    tier: "budget",
    strengths: ["fast", "general"],
    contextK: 1048,
    inputPricePerM: 0.14,
    outputPricePerM: 0.28,
    cacheReadPricePerM: 0.0028,
    supportsCache: true,
  },
  {
    id: "llama-4-maverick",
    name: "Llama 4 Maverick",
    provider: "Meta",
    isOpen: true,
    tier: "budget",
    strengths: ["long-context", "general"],
    contextK: 1048,
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
    supportsCache: false,
  },
  {
    id: "llama-3.3-70b",
    name: "Llama 3.3 70B",
    provider: "Meta",
    isOpen: true,
    tier: "budget",
    strengths: ["general"],
    contextK: 131,
    inputPricePerM: 0.10,
    outputPricePerM: 0.32,
    supportsCache: false,
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax M2.7",
    provider: "MiniMax",
    isOpen: true,
    tier: "budget",
    strengths: ["general"],
    contextK: 196,
    inputPricePerM: 0.30,
    outputPricePerM: 1.20,
    supportsCache: false,
  },
  {
    id: "mistral-large-2",
    name: "Mistral Large 2",
    provider: "Mistral",
    isOpen: true,
    tier: "budget",
    strengths: ["general"],
    contextK: 262,
    inputPricePerM: 0.50,
    outputPricePerM: 1.50,
    cacheReadPricePerM: 0.05,
    supportsCache: true,
  },
];

export const TIER_LABEL: Record<Tier, string> = {
  frontier: "Frontier",
  mid: "Mid",
  budget: "Budget",
};

export const STRENGTH_LABEL: Record<Strength, string> = {
  coding: "Coding",
  reasoning: "Reasoning",
  multimodal: "Multimodal",
  "long-context": "Long context",
  fast: "Fast",
  general: "General",
};

export type AgentConfig = {
  modelId: string;
  systemPromptTokens: number;
  inputTokensPerRun: number;
  outputTokensPerRun: number;
  toolCallsPerRun: number;
  tokensPerToolCall: number;
  cacheHitRate: number;
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

export function filterModels(
  models: Model[],
  tiers: Set<Tier>,
  types: Set<"closed" | "open">,
  strengths: Set<Strength>,
): Model[] {
  return models.filter((m) => {
    if (tiers.size > 0 && !tiers.has(m.tier)) return false;
    if (types.size > 0) {
      const t = m.isOpen ? "open" : "closed";
      if (!types.has(t)) return false;
    }
    if (strengths.size > 0) {
      const hasAny = m.strengths.some((s) => strengths.has(s));
      if (!hasAny) return false;
    }
    return true;
  });
}
