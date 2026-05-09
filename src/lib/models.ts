export type Model = {
  id: string;
  name: string;
  provider: string;
  inputPricePerM: number;   // $ per 1M input tokens
  outputPricePerM: number;  // $ per 1M output tokens
  cacheReadPricePerM?: number;  // $ per 1M cached read tokens
  cacheWritePricePerM?: number; // $ per 1M cache write tokens
  supportsCache: boolean;
};

export const MODELS: Model[] = [
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
    inputPricePerM: 0.80,
    outputPricePerM: 4.0,
    cacheReadPricePerM: 0.08,
    cacheWritePricePerM: 1.0,
    supportsCache: true,
  },
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    inputPricePerM: 15.0,
    outputPricePerM: 75.0,
    cacheReadPricePerM: 1.50,
    cacheWritePricePerM: 18.75,
    supportsCache: true,
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    inputPricePerM: 2.50,
    outputPricePerM: 10.0,
    cacheReadPricePerM: 1.25,
    supportsCache: true,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "OpenAI",
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
    cacheReadPricePerM: 0.075,
    supportsCache: true,
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "Google",
    inputPricePerM: 1.25,
    outputPricePerM: 5.0,
    supportsCache: false,
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash",
    provider: "Google",
    inputPricePerM: 0.075,
    outputPricePerM: 0.30,
    supportsCache: false,
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
