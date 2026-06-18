// Phase 3 end-to-end replay HARNESS (docs/RESEARCH-validation-methodology.md §4.4).
// Two pure functions, ZERO network calls:
//   (1) buildReplayPlan adapts captured rawCalls into replay descriptors the
//       operator runs against model B with their OWN API key (outside this app);
//   (2) evaluateReplay consumes the operator's ACTUAL B usages and computes
//       counterfactual-vs-actual per-pair diffs + median/P95 + the acceptance gate.
// EMPIRICALLY UNPROVEN until the operator runs the plan against real model B with
// a live API key and feeds the actual `raw_usage` back into evaluateReplay. This
// module makes ZERO live calls and does NOT claim the empirical ±5% result.
//
// Input-side prompt-token diff is the PRIMARY (cleanest) gate: same prompt text,
// B's real tokenization. Output-side cost diff is NOISY (B generates different
// text). The methodology says: "isolate the input component if needed."
//
// Actual-cost math (cost_B) DELEGATES to computeCallCost (reconstructCost) by
// default — all providers (Anthropic/OpenAI/Gemini) via each model's REAL
// cacheReadPricePerM. A pluggable actualCostFn still overrides per-pair. Unknown
// usage shape -> computeCallCost throws ReconstructError UNKNOWN_PRICING.
//
// NEVER reads the model verbosity multiplier (the heuristic this layer replaces) —
// countTokens is the only cross-model bridge on the counterfactual side. See docs/SPEC-phase3-replay.md.

import type { Model } from "./models";
import type { RawCall } from "./parseTrace";
import { countTokens, type TokenizerMethod } from "./tokenize";
import { computeCallCost } from "./reconstructCost";

export type ReplayItem = {
  index: number;
  promptText: string;
  completionText: string;
  notes: string[];
};

export type ReplayPlan = {
  targetModelId: string;
  targetProvider: string;
  items: ReplayItem[];
  warnings: string[];
};

export type ActualCall = {
  usage: Record<string, unknown>;
  billedCost?: number | null;
};

export type ReplayPair = {
  index: number;
  counterfactualInputTokens: number | null;
  counterfactualOutputTokens: number;
  counterfactualCost: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCost: number;
  billedCost: number | null;
  inputTokenDiffPct: number | null;
  costDiffPct: number;
  method: TokenizerMethod;
};

export type ReplayEvaluation = {
  pairs: ReplayPair[];
  sampleSize: number;
  inputTokenDiffMedianPct: number | null;
  inputTokenDiffP95Pct: number | null;
  costDiffMedianPct: number;
  costDiffP95Pct: number;
  passesPhase3: boolean;
  gateBasis: "input" | "cost";
  method: TokenizerMethod;
  warnings: string[];
};

export type ActualCostFn = (usage: Record<string, unknown>, model: Model) => number;

export class ReplayError extends Error {
  constructor(
    message: string,
    public readonly code: "LENGTH_MISMATCH" | "UNSUPPORTED_PROVIDER",
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

// Coerce a raw_usage field to a non-negative finite number; anything else -> 0.
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

// Provider-agnostic actual token counts for evaluateReplay's diff side. Reads
// Anthropic (input_tokens/output_tokens), OpenAI (prompt_tokens/completion_tokens),
// Gemini (prompt_token_count / candidates+thoughts) via shape detection.
function actualTokenCounts(usage: Record<string, unknown>): {
  input: number;
  output: number;
} {
  if ("input_tokens" in usage) {
    return { input: num(usage.input_tokens), output: num(usage.output_tokens) };
  }
  if ("prompt_tokens" in usage) {
    return {
      input: num(usage.prompt_tokens),
      output: num(usage.completion_tokens),
    };
  }
  if ("prompt_token_count" in usage || "usage_metadata" in usage) {
    const umObj =
      usage.usage_metadata &&
      typeof usage.usage_metadata === "object" &&
      !Array.isArray(usage.usage_metadata)
        ? (usage.usage_metadata as Record<string, unknown>)
        : usage;
    return {
      input: num(umObj.prompt_token_count),
      output: num(umObj.candidates_token_count) + num(umObj.thoughts_token_count),
    };
  }
  return { input: 0, output: 0 };
}

/**
 * Adapts captured rawCalls into replay descriptors the operator runs against
 * model B. NO network. Each ReplayItem carries the captured promptText + the
 * captured completionText (the completion text is what counterfactual
 * re-tokenization runs over). Notes flag response-only calls where input-side
 * replay is unavailable.
 */
export function buildReplayPlan(rawCalls: RawCall[], target: Model): ReplayPlan {
  const items: ReplayItem[] = rawCalls.map((raw, i) => {
    const ftc = raw.full_text_content;
    const promptText = ftc?.promptText ?? "";
    const completionText = ftc?.completionText ?? "";
    const notes: string[] = [];
    if (promptText === "") {
      notes.push(
        "no prompt text captured (response-only) - input-side replay unavailable for this call",
      );
    }
    return { index: i, promptText, completionText, notes };
  });

  const warnings: string[] = [
    "original request tool schemas are NOT captured (response traces do not echo them) - replay omits tools, so counterfactual undercounts tool/system tokens; residual per deliverable 3.3",
  ];
  if (items.some((it) => it.promptText === "")) {
    warnings.push(
      "input-side replay is partial: some calls have no captured prompt text (response-only)",
    );
  }

  return {
    targetModelId: target.id,
    targetProvider: target.provider,
    items,
    warnings,
  };
}

/**
 * Consumes operator-supplied ACTUAL B usages (one per plan item, call-order
 * aligned) and computes per-pair counterfactual-vs-actual diffs, median/P95, and
 * the Phase 3 acceptance gate. The counterfactual side (cost_B') re-tokenizes the
 * captured text with B's tokenizer via countTokens (exact OpenAI, approx
 * Anthropic/Gemini) and prices at B's list rates (no-cache default). The actual
 * side (cost_B) uses actualCostFn (Anthropic default; OpenAI/Gemini via increment
 * c). The PRIMARY gate is the input-side prompt-token diff (cleanest); output-side
 * cost diff is noisy (B generates different text).
 */
export function evaluateReplay(
  plan: ReplayPlan,
  actuals: ActualCall[],
  target: Model,
  actualCostFn?: ActualCostFn,
): ReplayEvaluation {
  if (actuals.length !== plan.items.length) {
    throw new ReplayError(
      `actuals length (${actuals.length}) must equal plan.items length (${plan.items.length})`,
      "LENGTH_MISMATCH",
    );
  }

  // Default actual-cost delegates to computeCallCost (all providers; OpenAI/Gemini
  // via the model's REAL cacheReadPricePerM). Unknown usage shape -> computeCallCost
  // throws ReconstructError UNKNOWN_PRICING (no more UNSUPPORTED_PROVIDER here).
  const fn: ActualCostFn =
    actualCostFn ?? ((usage, model) => computeCallCost(usage, model).cost);

  const pairs: ReplayPair[] = plan.items.map((item, i) => {
    const usage = actuals[i].usage;
    const { input: actInput, output: actOutput } = actualTokenCounts(usage);

    const cfInput =
      item.promptText.length > 0
        ? countTokens(item.promptText, target.id, target.provider)
        : null;
    const cfOutput = countTokens(item.completionText, target.id, target.provider);

    const outputCost = (cfOutput.count / 1e6) * target.outputPricePerM;
    const inputCost = cfInput
      ? (cfInput.count / 1e6) * target.inputPricePerM
      : 0;
    const cfCost = outputCost + inputCost;

    const actCost = fn(usage, target);
    const billed = actuals[i].billedCost ?? null;

    const inputTokenDiffPct =
      cfInput !== null && actInput > 0
        ? Math.abs(cfInput.count - actInput) / actInput
        : null;
    const costDiffPct = actCost > 0 ? Math.abs(cfCost - actCost) / actCost : 0;

    const method: TokenizerMethod =
      cfOutput.method === "approx" || cfInput?.method === "approx"
        ? "approx"
        : "exact";

    return {
      index: i,
      counterfactualInputTokens: cfInput?.count ?? null,
      counterfactualOutputTokens: cfOutput.count,
      counterfactualCost: cfCost,
      actualInputTokens: actInput,
      actualOutputTokens: actOutput,
      actualCost: actCost,
      billedCost: billed,
      inputTokenDiffPct,
      costDiffPct,
      method,
    };
  });

  const sampleSize = pairs.length;
  const inputDiffs = pairs
    .filter((p) => p.inputTokenDiffPct !== null)
    .map((p) => p.inputTokenDiffPct as number);
  const costDiffs = pairs.map((p) => p.costDiffPct);

  const inputTokenDiffMedianPct = inputDiffs.length > 0 ? median(inputDiffs) : null;
  const inputTokenDiffP95Pct = inputDiffs.length > 0 ? p95(inputDiffs) : null;
  const costDiffMedianPct = median(costDiffs);
  const costDiffP95Pct = p95(costDiffs);

  const methodWorst: TokenizerMethod = pairs.some((p) => p.method === "approx")
    ? "approx"
    : "exact";
  const gateBasis: "input" | "cost" = inputDiffs.length > 0 ? "input" : "cost";
  const passesPhase3 =
    gateBasis === "input"
      ? inputTokenDiffMedianPct! <= 0.05 && inputTokenDiffP95Pct! <= 0.10
      : costDiffMedianPct <= 0.05 && costDiffP95Pct <= 0.10;

  const warnings: string[] = [];
  if (sampleSize < 20) {
    warnings.push(
      `sample size ${sampleSize} < 20: methodology 4.4 requires >=20 calls; gate not statistically meaningful`,
    );
  }
  if (gateBasis === "cost") {
    warnings.push(
      "gate based on COST diff (no prompt text captured) - output-side is noisy (B generates different text); interpret loosely",
    );
  }
  if (methodWorst === "approx") {
    warnings.push(
      "target tokenizer is approx (Anthropic/Gemini): counterfactual side is a char-ratio estimate; input-side diff reflects approx error, not pure tokenizer accuracy",
    );
  }

  return {
    pairs,
    sampleSize,
    inputTokenDiffMedianPct,
    inputTokenDiffP95Pct,
    costDiffMedianPct,
    costDiffP95Pct,
    passesPhase3,
    gateBasis,
    method: methodWorst,
    warnings,
  };
}

/**
 * Median of a numeric array. Empty -> 0. Sorts ascending; for odd n returns the
 * middle element (arr[floor(n/2)]); for even n returns the mean of the two middle
 * elements ((arr[n/2-1] + arr[n/2]) / 2). Does NOT mutate the input.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return n % 2 === 1
    ? sorted[Math.floor(n / 2)]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/**
 * P95 of a numeric array via NEAREST-RANK. Empty -> 0. Sorts ascending; the P95
 * element is the value at index `min(n-1, ceil(0.95*n) - 1)` (1-indexed rank
 * ceil(0.95*n), converted to 0-indexed). Does NOT mutate the input.
 */
export function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = Math.min(n - 1, Math.ceil(0.95 * n) - 1);
  return sorted[idx];
}
