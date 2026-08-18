export type Tier = "frontier" | "mid" | "budget";
export type Strength =
  | "coding"
  | "reasoning"
  | "multimodal"
  | "long-context"
  | "fast"
  | "general";

export type CapabilityScores = {
  coding: number;
  reasoning: number;
  general: number;
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

export type PricingStatus = "live" | "carried-forward";

export type Model = {
  id: string;
  sourceId?: string;
  name: string;
  /** Lab / developer that trained the model. */
  modelDeveloper: string;
  /** Host whose listed price was selected. May differ from modelDeveloper. */
  pricingProvider: string;
  pricingStatus: PricingStatus;
  pricingFetchedAt?: string;
  /** Alias of modelDeveloper for search/filter compatibility. */
  provider: string;
  isOpen: boolean;
  tier: Tier;
  strengths: Strength[];
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
  outputMultiplier: number;
  multiplierSource?: string;
  multiplierConfidence?: "high" | "med" | "low";
  capability?: ModelCapability;
};

type GeneratedPricingEntry = {
  id: string;
  sourceId: string;
  name: string;
  modelDeveloper: string;
  pricingProvider: string;
  pricingStatus: PricingStatus;
  pricingFetchedAt?: string;
  isOpen: boolean;
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
};

import generatedPricing from "./pricing.generated.json";
import { EDITORIAL_CATALOG } from "../../scripts/model-catalog";

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
  const result: Model[] = [];

  for (const ed of EDITORIAL_CATALOG) {
    const gen = PRICING_BY_ID.get(ed.id);
    if (!gen) continue;

    const modelDeveloper = gen.modelDeveloper;
    result.push({
      id: ed.id,
      sourceId: gen.sourceId || ed.sourceId || undefined,
      name: gen.name,
      modelDeveloper,
      pricingProvider: gen.pricingProvider,
      pricingStatus: gen.pricingStatus,
      pricingFetchedAt: gen.pricingFetchedAt,
      provider: modelDeveloper,
      isOpen: gen.isOpen,
      tier: ed.tier,
      strengths: ed.strengths,
      contextK: gen.contextK,
      inputPricePerM: gen.inputPricePerM,
      outputPricePerM: gen.outputPricePerM,
      cacheReadPricePerM: gen.cacheReadPricePerM,
      cacheWritePricePerM: gen.cacheWritePricePerM,
      supportsCache: gen.supportsCache,
      outputMultiplier: ed.outputMultiplier,
      multiplierSource: ed.multiplierSource,
      multiplierConfidence: ed.multiplierConfidence,
      capability: ed.capability,
    });
  }

  return result;
}

export const MODELS: Model[] = buildModels();

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
  effectiveOutputTokens: number;
};

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
  const cacheWriteCost =
    resolvedModel.cacheWritePricePerM && config.cacheHitRate < 1
      ? (config.systemPromptTokens / 1_000_000) *
        resolvedModel.cacheWritePricePerM *
        (1 - config.cacheHitRate)
      : 0;

  const effectiveOutputTokens = options?.applyMultiplier
    ? config.outputTokensPerRun * resolvedModel.outputMultiplier
    : config.outputTokensPerRun;

  const outputCost =
    (effectiveOutputTokens / 1_000_000) * resolvedModel.outputPricePerM;

  const toolCallCost =
    ((config.toolCallsPerRun * config.tokensPerToolCall) / 1_000_000) *
    ((resolvedModel.inputPricePerM + resolvedModel.outputPricePerM) / 2);

  const totalPerRun =
    inputCost + cachedInputCost + cacheWriteCost + outputCost + toolCallCost;
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
    if (tiers.size > 0 && !tiers.has(m.tier)) return false;
    if (types.size > 0) {
      const t = m.isOpen ? "open" : "closed";
      if (!types.has(t)) return false;
    }
    if (strengths.size > 0) {
      const hasAny = m.strengths.some((s) => strengths.has(s));
      if (!hasAny) return false;
    }
    if (provider && provider !== "" && m.modelDeveloper !== provider) return false;
    if (query) {
      const haystack = [
        m.name,
        m.modelDeveloper,
        m.pricingProvider,
        m.id,
        m.sourceId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
