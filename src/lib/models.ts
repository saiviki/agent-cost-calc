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

export type BenchmarkEntry = {
  name: string;
  score: number | string;
  metric?: string;
  source?: string;
};

export type Model = {
  id: string;
  sourceId?: string;
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
  // Optional capability / benchmark metadata from the sync pipeline (unused by UI).
  capability?: ModelCapability;
  benchmarks?: BenchmarkEntry[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Data pipeline — two layers (see scripts/model-catalog.ts):
//   1. pricing.generated.json : machine-truthable, written by sync-models.ts
//      from models.dev /catalog.json. Pricing, context window, provider.
//   2. Editorial catalog      : human judgment. Tier, strengths, outputMultiplier,
//      capability scores. Lives in scripts/model-catalog.ts.
// MODELS merges both at module load: editorial wins for judgment fields,
// generated wins for volatile fields. Update pricing via `npm run sync-models`.
// ─────────────────────────────────────────────────────────────────────────────

type GeneratedPricingEntry = {
  id: string;
  sourceId: string;
  name: string;
  provider: string;
  isOpen: boolean;
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
  benchmarks?: BenchmarkEntry[];
};

import generatedPricing from "./pricing.generated.json";
import { EDITORIAL_CATALOG, type EditorialEntry } from "../../scripts/model-catalog";

export const PRICING_SNAPSHOT: {
  source: string;
  fetchedAt: string;
  sourceEndpoint: string;
  models: GeneratedPricingEntry[];
} = generatedPricing as unknown as {
  source: string;
  fetchedAt: string;
  sourceEndpoint: string;
  models: GeneratedPricingEntry[];
};

const PRICING_BY_ID = new Map<string, GeneratedPricingEntry>(
  PRICING_SNAPSHOT.models.map((m) => [m.id, m]),
);

function buildModels(): Model[] {
  const editorialById = new Map(EDITORIAL_CATALOG.map((e) => [e.id, e]));
  const editorialBySourceId = new Map(
    EDITORIAL_CATALOG.filter((e) => e.sourceId).map((e) => [e.sourceId, e])
  );

  const result: Model[] = [];
  const processedIds = new Set<string>();

  for (const gen of PRICING_SNAPSHOT.models) {
    const ed = editorialBySourceId.get(gen.sourceId) ?? editorialById.get(gen.id);
    const id = ed?.id ?? gen.id;
    if (processedIds.has(id)) continue;
    processedIds.add(id);

    result.push({
      id,
      sourceId: gen.sourceId,
      name: gen.name,
      provider: gen.provider,
      isOpen: gen.isOpen,
      tier: ed?.tier ?? (gen as any).tier ?? "budget",
      strengths: ed?.strengths ?? (gen as any).strengths ?? ["general"],
      contextK: gen.contextK,
      inputPricePerM: gen.inputPricePerM,
      outputPricePerM: gen.outputPricePerM,
      cacheReadPricePerM: gen.cacheReadPricePerM,
      cacheWritePricePerM: gen.cacheWritePricePerM,
      supportsCache: gen.supportsCache,
      outputMultiplier: ed?.outputMultiplier ?? (gen as any).outputMultiplier ?? 1.0,
      multiplierSource: ed?.multiplierSource ?? (gen as any).multiplierSource,
      multiplierConfidence: ed?.multiplierConfidence ?? (gen as any).multiplierConfidence,
      capability: ed?.capability ?? (gen as any).capability,
      benchmarks: gen.benchmarks,
    });
  }

  return result;
}

export const MODELS: Model[] = buildModels();

// Exposed for diagnostics / the sync report. Not used by the cost engine.
export const PRICING_FETCHED_AT: string = PRICING_SNAPSHOT.fetchedAt;
export const PRICING_SOURCE: string = PRICING_SNAPSHOT.source;

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
  searchQuery?: string,
  provider?: string,
): Model[] {
  const query = searchQuery?.trim().toLowerCase();
  return models.filter((m) => {
    // Exclude non-LLM models (audio transcription like Whisper, text embeddings, zero-output price)
    const nameLower = m.name.toLowerCase();
    const idLower = m.id.toLowerCase();
    if (
      nameLower.includes("whisper") ||
      nameLower.includes("embedding") ||
      idLower.includes("whisper") ||
      idLower.includes("embedding") ||
      m.outputPricePerM === 0
    ) {
      return false;
    }

    if (tiers.size > 0 && !tiers.has(m.tier)) return false;
    if (types.size > 0) {
      const t = m.isOpen ? "open" : "closed";
      if (!types.has(t)) return false;
    }
    if (strengths.size > 0) {
      const hasAny = m.strengths.some((s) => strengths.has(s));
      if (!hasAny) return false;
    }
    if (provider && provider !== "" && m.provider !== provider) return false;
    if (query) {
      const matchName = m.name.toLowerCase().includes(query);
      const matchProvider = m.provider.toLowerCase().includes(query);
      const matchId = m.id.toLowerCase().includes(query);
      if (!matchName && !matchProvider && !matchId) return false;
    }
    return true;
  });
}
