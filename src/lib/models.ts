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

// ─────────────────────────────────────────────────────────────────────────────
// Data pipeline — two layers (see scripts/model-catalog.ts):
//   1. pricing.generated.json : machine-truthable, written by sync-models.ts
//      from OpenRouter's /api/v1/models. Pricing, context window, provider.
//   2. Editorial catalog      : human judgment. Tier, strengths, outputMultiplier,
//      capability scores. Lives in scripts/model-catalog.ts.
// MODELS merges both at module load: editorial wins for judgment fields,
// generated wins for volatile fields. Update pricing via `npm run sync-models`.
// ─────────────────────────────────────────────────────────────────────────────

type GeneratedPricingEntry = {
  id: string;
  openrouterSlug: string;
  name: string;
  provider: string;
  isOpen: boolean;
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
};

import generatedPricing from "./pricing.generated.json";
import { EDITORIAL_CATALOG, type EditorialEntry } from "../../scripts/model-catalog";

const PRICING_SNAPSHOT = generatedPricing as {
  source: string;
  fetchedAt: string;
  openRouterEndpoint: string;
  models: GeneratedPricingEntry[];
};

const PRICING_BY_ID = new Map<string, GeneratedPricingEntry>(
  PRICING_SNAPSHOT.models.map((m) => [m.id, m]),
);

function buildModels(): Model[] {
  return EDITORIAL_CATALOG.map((entry: EditorialEntry): Model => {
    const gen = PRICING_BY_ID.get(entry.id);
    if (!gen) {
      // The editorial catalog lists a model that isn't in pricing.generated.json.
      // This happens when sync-models.ts is run with --allow-missing (e.g. a
      // vendor slug temporarily isn't listed on OpenRouter). Fall back to safe
      // defaults so the app keeps rendering; the cost engine will still run but
      // pricing will be visibly zero until the model is re-synced.
      return {
        id: entry.id,
        name: entry.id,
        provider: "Unknown",
        isOpen: false,
        tier: entry.tier,
        strengths: entry.strengths,
        contextK: 0,
        inputPricePerM: 0,
        outputPricePerM: 0,
        supportsCache: false,
        outputMultiplier: entry.outputMultiplier,
        multiplierSource: entry.multiplierSource,
        multiplierConfidence: entry.multiplierConfidence,
        capability: entry.capability,
      };
    }
    return {
      id: entry.id,
      name: gen.name,
      provider: gen.provider,
      isOpen: gen.isOpen,
      tier: entry.tier,
      strengths: entry.strengths,
      contextK: gen.contextK,
      inputPricePerM: gen.inputPricePerM,
      outputPricePerM: gen.outputPricePerM,
      cacheReadPricePerM: gen.cacheReadPricePerM,
      cacheWritePricePerM: gen.cacheWritePricePerM,
      supportsCache: gen.supportsCache,
      outputMultiplier: entry.outputMultiplier,
      multiplierSource: entry.multiplierSource,
      multiplierConfidence: entry.multiplierConfidence,
      capability: entry.capability,
    };
  });
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
