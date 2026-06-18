// S3 — Counterfactual engine. Implements SPEC-effective-cost.md §3.
// Pure synchronous TypeScript. No DOM.

import {
  AgentConfig,
  Model,
  CostBreakdown,
  calculateCost,
  MODELS,
} from "./models";

export type Projection = {
  model: Model;
  breakdown: CostBreakdown; // computed with applyMultiplier: true
  effectiveOutputTokens: number; // convenience duplicate of breakdown.effectiveOutputTokens
  multiplierUsed: number; // model.outputMultiplier at time of computation
  isAnchor: boolean; // true when model.id === config.modelId
  deltaVsAnchorPct: number | null; // null for the anchor row (and when undefined anchor / zero-cost anchor)
};

export function projectCounterfactual(
  config: AgentConfig,
  models?: Model[],
): Projection[] {
  const set = models ?? MODELS;

  // Identify the anchor model (may be undefined if config.modelId is unknown).
  const anchorModel = set.find((m) => m.id === config.modelId);

  // Compute effective cost for every model.
  const rows = set.map((model) => {
    const breakdown = calculateCost(config, model, { applyMultiplier: true });
    const effectiveOutputTokens =
      config.outputTokensPerRun * model.outputMultiplier;
    return {
      model,
      breakdown,
      effectiveOutputTokens,
      multiplierUsed: model.outputMultiplier,
      isAnchor: anchorModel !== undefined && model.id === anchorModel.id,
      deltaVsAnchorPct: null as number | null,
    };
  });

  // Anchor monthly cost for the delta math.
  const anchorRow = anchorModel
    ? rows.find((r) => r.model.id === anchorModel.id)
    : undefined;
  const anchorMonthly = anchorRow?.breakdown.totalPerMonth;

  // Compute deltaVsAnchorPct unless anchor is undefined or zero-cost.
  if (anchorMonthly !== undefined && anchorMonthly !== 0) {
    for (const r of rows) {
      if (r.isAnchor) {
        r.deltaVsAnchorPct = null;
      } else {
        const raw =
          ((r.breakdown.totalPerMonth - anchorMonthly) / anchorMonthly) * 100;
        r.deltaVsAnchorPct = Math.round(raw * 10) / 10; // one decimal
      }
    }
  }

  // Sort cheapest-first by monthly cost.
  rows.sort((a, b) => a.breakdown.totalPerMonth - b.breakdown.totalPerMonth);

  return rows;
}

export type CacheRateInsight = {
  measured: number; // config.cacheHitRate (observed rate, 0–1)
  atNinety: number; // 0.90 — the "what-if" target
  monthlySavingAtNinety: number;
};

export function cacheRateInsight(config: AgentConfig): CacheRateInsight {
  const model = MODELS.find((m) => m.id === config.modelId);

  // GUARD: unknown model (hand-entered config) → no saving math possible.
  if (!model) {
    return {
      measured: config.cacheHitRate,
      atNinety: 0.9,
      monthlySavingAtNinety: 0,
    };
  }

  const totalInput = config.systemPromptTokens + config.inputTokensPerRun;
  const readPrice = model.cacheReadPricePerM ?? 0;
  const writePrice = model.cacheWritePricePerM ?? 0;

  // At current measured rate.
  const cachedNow = totalInput * config.cacheHitRate;
  const uncachedNow = totalInput - cachedNow;
  const inputCostNow = (uncachedNow / 1e6) * model.inputPricePerM;
  const cacheReadCostNow = (cachedNow / 1e6) * readPrice;
  const cacheWriteCostNow =
    (config.systemPromptTokens / 1e6) * writePrice * (1 - config.cacheHitRate);
  const totalInputCostNow = inputCostNow + cacheReadCostNow + cacheWriteCostNow;

  // At 90% rate.
  const cached90 = totalInput * 0.9;
  const uncached90 = totalInput - cached90;
  const inputCost90 = (uncached90 / 1e6) * model.inputPricePerM;
  const cacheReadCost90 = (cached90 / 1e6) * readPrice;
  const cacheWriteCost90 =
    (config.systemPromptTokens / 1e6) * writePrice * (1 - 0.9);
  const totalInputCost90 = inputCost90 + cacheReadCost90 + cacheWriteCost90;

  const monthlySavingAtNinety =
    (totalInputCostNow - totalInputCost90) * config.runsPerDay * 30;

  return {
    measured: config.cacheHitRate,
    atNinety: 0.9,
    monthlySavingAtNinety,
  };
}
