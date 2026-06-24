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

// ── Trace types ───────────────────────────────────────────────────────
export interface Span {
  call_id: string;
  model_id: string;
  tool_name?: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
}

export interface Trace {
  trace_id: string;
  spans: Span[];
}

// ── Verbosity multiplier ──────────────────────────────────────────────
export interface VerbosityEntry {
  model_id: string; // must match a Model.id
  v: number;
}

// ── Counterfactual result types ───────────────────────────────────────
export interface SpanCost {
  call_id: string;
  tool_name?: string;
  original_cost: number;
  counterfactual_cost: number;
}

export interface CounterfactualResult {
  model_id: string;
  model_name: string;
  total_cost: number;
  delta_vs_original: number; // fraction; positive = cheaper
  verbosity_multiplier: number;
  scaled_output_tokens: number;
  top_cost_driver: string; // tool_name with highest Σ cost
  per_span_costs: SpanCost[];
}

// ── Default verbosity multipliers ─────────────────────────────────────
export const DEFAULT_VERBOSITY_MAP: VerbosityEntry[] = [
  { model_id: "claude-opus-4-7", v: 1.0 },
  { model_id: "claude-sonnet-4-6", v: 1.0 },
  { model_id: "claude-haiku-4-5", v: 1.1 },
  { model_id: "gpt-5.5", v: 1.05 },
  { model_id: "gpt-5.4-mini", v: 1.08 },
  { model_id: "gemini-3.1-pro", v: 1.0 },
  { model_id: "gemini-3-flash", v: 0.95 },
  { model_id: "deepseek-v4-pro", v: 1.12 },
  { model_id: "deepseek-v4-flash", v: 1.12 },
  { model_id: "kimi-k2.6", v: 1.08 },
  { model_id: "glm-5.1", v: 1.1 },
  { model_id: "qwen-3.6-plus", v: 1.1 },
  { model_id: "llama-3.3-70b", v: 1.15 },
  { model_id: "minimax-m2.7", v: 1.08 },
  { model_id: "mistral-large-2", v: 1.05 },
  { model_id: "grok-4.1-fast", v: 1.05 },
];

export function buildVerbosityMap(
  entries: VerbosityEntry[]
): Map<string, number> {
  return new Map(entries.map((e) => [e.model_id, e.v]));
}

// ── Example trace ─────────────────────────────────────────────────────
export const EXAMPLE_TRACE: Trace = {
  trace_id: "checkout-agent-2026-06-09",
  spans: [
    {
      call_id: "s1",
      model_id: "claude-opus-4-7",
      tool_name: "retriever",
      input_tokens: 4200,
      output_tokens: 890,
      cached_tokens: 1800,
    },
    {
      call_id: "s2",
      model_id: "claude-opus-4-7",
      tool_name: "retriever",
      input_tokens: 3800,
      output_tokens: 1200,
      cached_tokens: 2100,
    },
    {
      call_id: "s3",
      model_id: "claude-opus-4-7",
      tool_name: "code_executor",
      input_tokens: 6500,
      output_tokens: 2100,
      cached_tokens: 3000,
    },
    {
      call_id: "s4",
      model_id: "claude-opus-4-7",
      tool_name: "code_executor",
      input_tokens: 5800,
      output_tokens: 1800,
      cached_tokens: 3200,
    },
    {
      call_id: "s5",
      model_id: "claude-opus-4-7",
      tool_name: "retriever",
      input_tokens: 4100,
      output_tokens: 950,
      cached_tokens: 2200,
    },
    {
      call_id: "s6",
      model_id: "claude-opus-4-7",
      tool_name: "reviewer",
      input_tokens: 7200,
      output_tokens: 3200,
      cached_tokens: 4000,
    },
    {
      call_id: "s7",
      model_id: "claude-opus-4-7",
      tool_name: "code_executor",
      input_tokens: 6100,
      output_tokens: 2400,
      cached_tokens: 3500,
    },
    {
      call_id: "s8",
      model_id: "claude-opus-4-7",
      tool_name: "reviewer",
      input_tokens: 5500,
      output_tokens: 1600,
      cached_tokens: 3100,
    },
  ],
};

// ── Core calculation ──────────────────────────────────────────────────

/**
 * Compute the cost of a single span on a target model.
 *
 * cost_span(i, m) = [(input_i - cached_i)*P_in(m) + cached_i*P_cr(m) + (output_i*V_m)*P_out(m)] / 1e6
 */
export function costSpan(
  span: Span,
  model: Model,
  verbosity: number
): number {
  const uncachedInput = span.input_tokens - span.cached_tokens;
  const scaledOutput = span.output_tokens * verbosity;

  const cacheReadPerM = model.cacheReadPricePerM ?? model.inputPricePerM;

  const inputCost = uncachedInput * model.inputPricePerM;
  const cacheCost = span.cached_tokens * cacheReadPerM;
  const outputCost = scaledOutput * model.outputPricePerM;

  return (inputCost + cacheCost + outputCost) / 1_000_000;
}

/**
 * Compute counterfactual results for all models given a trace.
 *
 * Cost(trace, m) = Σ cost_span(i, m)
 * Δ(m, ref) = 1 − Cost(m) / Cost(ref)   (+ve = cheaper)
 */
export function computeCounterfactual(
  trace: Trace,
  pricingTable: Model[],
  verbosityMap: Map<string, number>
): CounterfactualResult[] {
  // Determine original (reference) model from first span
  const originalModelId = trace.spans[0]?.model_id ?? "";
  const originalModel = pricingTable.find((m) => m.id === originalModelId);

  // Compute reference cost (V=1.0 for original)
  let referenceCost = 0;
  if (originalModel) {
    for (const span of trace.spans) {
      referenceCost += costSpan(span, originalModel, 1.0);
    }
  }

  // Compute for every model
  const results: CounterfactualResult[] = pricingTable.map((model) => {
    const v = verbosityMap.get(model.id) ?? 1.0;
    let totalCost = 0;
    let totalScaledOutput = 0;
    const toolCosts = new Map<string, number>();
    const perSpanCosts: SpanCost[] = [];

    for (const span of trace.spans) {
      const origCost = originalModel ? costSpan(span, originalModel, 1.0) : 0;
      const cfCost = costSpan(span, model, v);
      totalCost += cfCost;
      totalScaledOutput += span.output_tokens * v;

      const toolName = span.tool_name ?? "(untitled)";
      toolCosts.set(toolName, (toolCosts.get(toolName) ?? 0) + cfCost);

      perSpanCosts.push({
        call_id: span.call_id,
        tool_name: span.tool_name,
        original_cost: origCost,
        counterfactual_cost: cfCost,
      });
    }

    // Find top cost driver
    let topDriver = "";
    let topDriverCost = -1;
    for (const [tool, cost] of toolCosts) {
      if (cost > topDriverCost) {
        topDriverCost = cost;
        topDriver = tool;
      }
    }

    const topDriverPct =
      totalCost > 0 && topDriverCost >= 0
        ? Math.round((topDriverCost / totalCost) * 100)
        : 0;

    const delta =
      referenceCost > 0 ? 1 - totalCost / referenceCost : 0;

    return {
      model_id: model.id,
      model_name: model.name,
      total_cost: totalCost,
      delta_vs_original: delta,
      verbosity_multiplier: v,
      scaled_output_tokens: totalScaledOutput,
      top_cost_driver: `${topDriver} (${topDriverPct}%)`,
      per_span_costs: perSpanCosts,
    };
  });

  return results;
}

// ── Parsers ───────────────────────────────────────────────────────────

export function parseTraceJSON(raw: string): Trace {
  const parsed = JSON.parse(raw);
  if (!parsed.trace_id || !Array.isArray(parsed.spans)) {
    throw new Error("Trace must have a 'trace_id' and 'spans' array");
  }
  for (const span of parsed.spans) {
    if (!span.call_id || !span.model_id) {
      throw new Error(
        "Each span must have 'call_id' and 'model_id'"
      );
    }
    if (
      typeof span.input_tokens !== "number" ||
      typeof span.output_tokens !== "number" ||
      typeof span.cached_tokens !== "number"
    ) {
      throw new Error(
        "Each span must have numeric 'input_tokens', 'output_tokens', 'cached_tokens'"
      );
    }
  }
  return parsed as Trace;
}

export function parseTraceCSV(raw: string): Trace {
  const lines = raw.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const requiredCols = ["call_id", "model_id", "input_tokens", "output_tokens", "cached_tokens"];
  for (const col of requiredCols) {
    if (!header.includes(col)) {
      throw new Error(`CSV missing required column: ${col}`);
    }
  }

  const idx = (col: string) => header.indexOf(col);

  const spans: Span[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",").map((c) => c.trim());
    spans.push({
      call_id: cols[idx("call_id")] ?? "",
      model_id: cols[idx("model_id")] ?? "",
      tool_name: header.includes("tool_name")
        ? cols[idx("tool_name")]
        : undefined,
      input_tokens: Number(cols[idx("input_tokens")] ?? 0),
      output_tokens: Number(cols[idx("output_tokens")] ?? 0),
      cached_tokens: Number(cols[idx("cached_tokens")] ?? 0),
    });
  }

  return {
    trace_id: `csv-import-${Date.now()}`,
    spans,
  };
}

export function parseTrace(raw: string): Trace {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseTraceJSON(trimmed);
  }
  return parseTraceCSV(trimmed);
}