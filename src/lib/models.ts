export type Tier = "frontier" | "mid" | "budget";
export type Strength =
  | "coding"
  | "reasoning"
  | "multimodal"
  | "long-context"
  | "fast"
  | "general";

// C3 — per-domain capability scores (0–100). See docs/RESEARCH-capability-matrix.md.
export type CapabilityScores = {
  coding: number; // 0–100
  reasoning: number; // 0–100
  general: number; // 0–100
};

export type CapabilityConfidence = "high" | "med" | "low";

export type ModelCapability = {
  scores: CapabilityScores;
  confidence: {
    coding: CapabilityConfidence;
    reasoning: CapabilityConfidence;
    general: CapabilityConfidence;
  };
};

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
  // S1 — output-token verbosity multiplier (effective output-tokens-per-task
  // relative to Claude Sonnet 4.6 non-reasoning = 1.0). See
  // docs/RESEARCH-consumption-multipliers.md. Default 1.0 when unknown.
  outputMultiplier: number;
  multiplierSource?: string;
  multiplierConfidence?: "high" | "med" | "low";
  // C3 — per-domain capability scores from RESEARCH-capability-matrix.md.
  // Optional for backward compat. Models without capability data are excluded
  // from recommendations (treated conservatively — see recommend.ts §4.3/Step 5).
  capability?: ModelCapability;
};

// S1 — multiplierSource string convention (SPEC-effective-cost.md §1.3)
const AA_SOURCE = "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30";

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
    outputMultiplier: 7.9,
    multiplierSource: AA_SOURCE + " — adaptive reasoning, max",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 92, reasoning: 90, general: 88 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
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
    outputMultiplier: 1.0,
    multiplierSource: AA_SOURCE + " — non-reasoning (baseline)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 85, reasoning: 74, general: 82 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
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
    outputMultiplier: 5.4,
    multiplierSource: AA_SOURCE + " — xhigh reasoning effort",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 91, reasoning: 91, general: 90 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
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
    outputMultiplier: 4.1,
    multiplierSource: AA_SOURCE + " — reasoning preview (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 85, reasoning: 92, general: 87 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
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
    outputMultiplier: 13.6,
    multiplierSource: AA_SOURCE + " — reasoning, max effort",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 88, reasoning: 82, general: 78 },
      confidence: { coding: "high", reasoning: "high", general: "med" },
    },
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
    outputMultiplier: 12.1,
    multiplierSource: AA_SOURCE + " — always-on reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 84, reasoning: 80, general: 75 },
      confidence: { coding: "high", reasoning: "high", general: "med" },
    },
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
    outputMultiplier: 0.59,
    multiplierSource: AA_SOURCE + " — non-reasoning",
    multiplierConfidence: "high",
    // coding=50 reflects non-reasoning mode only (consistent with outputMultiplier=0.59).
    // High-reasoning mode reaches 67% but is NOT the priced deployment mode.
    capability: {
      scores: { coding: 50, reasoning: 58, general: 65 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 0.17,
    multiplierSource: AA_SOURCE + " — non-reasoning (default)",
    multiplierConfidence: "high",
    // coding=66 is a conservative estimate — BenchLM flags insufficient overlapping
    // benchmark coverage (confidence: low on coding).
    capability: {
      scores: { coding: 66, reasoning: 60, general: 70 },
      confidence: { coding: "low", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 5.1,
    multiplierSource: AA_SOURCE + " — reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 72, reasoning: 70, general: 72 },
      confidence: { coding: "high", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 0.31,
    multiplierSource: AA_SOURCE + " — non-reasoning, fast variant",
    multiplierConfidence: "high",
    // coding is the known weak dimension (#44/117 in BenchLM).
    capability: {
      scores: { coding: 58, reasoning: 68, general: 65 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 7.1,
    multiplierSource: AA_SOURCE + " — reasoning (default); variant mixing on AA",
    multiplierConfidence: "med",
    capability: {
      scores: { coding: 78, reasoning: 76, general: 73 },
      confidence: { coding: "high", reasoning: "high", general: "med" },
    },
  },
  // ── BUDGET ──
  {
    id: "glm-5.1",
    name: "GLM 5.1",
    provider: "Z.ai",
    isOpen: true,
    tier: "budget",
    strengths: ["coding", "long-context"],
    contextK: 128,
    inputPricePerM: 0.14,
    outputPricePerM: 0.14,
    supportsCache: false,
    outputMultiplier: 1.0,
    multiplierSource: "placeholder: no reasoning-mode data on Artificial Analysis (2026-05-30)",
    multiplierConfidence: "low",
    capability: {
      scores: { coding: 72, reasoning: 68, general: 65 },
      confidence: { coding: "med", reasoning: "med", general: "low" },
    },
  },
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
    outputMultiplier: 17.1,
    multiplierSource: AA_SOURCE + " — reasoning, max effort",
    multiplierConfidence: "high",
    // coding=68 = default deployment only (non-extended-thinking). Max-effort reaches
    // near-parity with V4 Pro but that token burn is captured by outputMultiplier=17.1.
    capability: {
      scores: { coding: 68, reasoning: 62, general: 58 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 0.27,
    multiplierSource: AA_SOURCE + " — non-reasoning",
    multiplierConfidence: "med",
    capability: {
      scores: { coding: 52, reasoning: 48, general: 55 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 6.2,
    multiplierSource: AA_SOURCE + " — reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 58, reasoning: 55, general: 56 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
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
    outputMultiplier: 0.19,
    multiplierSource: AA_SOURCE + " — non-reasoning",
    multiplierConfidence: "high",
    // benchmarks are 2024-vintage, scored against 2026 competition → budget tier.
    capability: {
      scores: { coding: 60, reasoning: 52, general: 60 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
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
  // S1 — additive. Equals outputTokensPerRun when applyMultiplier=false (default),
  // equals outputTokensPerRun * model.outputMultiplier when applyMultiplier=true.
  effectiveOutputTokens: number;
};

// S1 — signature is additive: `model` and `options` are optional, so existing
// `calculateCost(config)` callers are unchanged. `applyMultiplier` defaults to
// `false`, preserving the exact prior output for every existing caller.
export function calculateCost(
  config: AgentConfig,
  model?: Model,
  options?: { applyMultiplier?: boolean },
): CostBreakdown {
  const resolvedModel = model ?? MODELS.find((m) => m.id === config.modelId);
  if (!resolvedModel) throw new Error("Model not found");

  const totalInput = config.systemPromptTokens + config.inputTokensPerRun;

  const cachedTokens = resolvedModel.supportsCache
    ? totalInput * config.cacheHitRate
    : 0;
  const uncachedTokens = totalInput - cachedTokens;

  const inputCost = (uncachedTokens / 1_000_000) * resolvedModel.inputPricePerM;
  const cachedInputCost = resolvedModel.cacheReadPricePerM
    ? (cachedTokens / 1_000_000) * resolvedModel.cacheReadPricePerM
    : 0;
  const cacheWriteCost = resolvedModel.cacheWritePricePerM && config.cacheHitRate < 1
    ? (config.systemPromptTokens / 1_000_000) * resolvedModel.cacheWritePricePerM * (1 - config.cacheHitRate)
    : 0;

  const effectiveOutputTokens = options?.applyMultiplier
    ? config.outputTokensPerRun * resolvedModel.outputMultiplier
    : config.outputTokensPerRun;

  const outputCost =
    (effectiveOutputTokens / 1_000_000) * resolvedModel.outputPricePerM;

  const toolCallCost =
    (config.toolCallsPerRun * config.tokensPerToolCall) / 1_000_000 *
    ((resolvedModel.inputPricePerM + resolvedModel.outputPricePerM) / 2);

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
    effectiveOutputTokens,
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
