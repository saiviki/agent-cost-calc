// Phase 1 reconstruction harness. Implements docs/RESEARCH-validation-methodology.md §4.2.
// Re-derives billed cost from provider raw_usage (GROUND TRUTH) + correct provider
// cache/batch rules, for comparison against actual invoice. Does NOT use the
// heuristic outputMultiplier — this is the deliverable's hard-rule foundation.
// Provider support: Anthropic, OpenAI, Gemini — each via the model REAL
// cacheReadPricePerM (no guessed multiplier). Unknown usage shape -> UNKNOWN_PRICING.

import type { Model } from "./models";
import type { RawCall } from "./parseTrace";

export type ProviderKind = "anthropic" | "openai" | "gemini" | "unknown";

export class ReconstructError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_RAW_USAGE" | "UNKNOWN_PRICING",
  ) {
    super(message);
    this.name = "ReconstructError";
  }
}

export type ReconstructedComponents = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  reasoningTokens: number; // OpenAI; 0 for Anthropic
  inputCost: number;
  cacheReadCost: number;
  cacheWrite5mCost: number;
  cacheWrite1hCost: number;
  outputCost: number;
  batchMultiplier: number; // 0.5 if is_batch else 1
};

export type ReconstructedCall = {
  provider: ProviderKind;
  computedCost: number; // pre-batch sum, then × batchMultiplier
  billedCost: number | null; // passed in via billedPerCall; null when unknown
  errorPct: number | null; // |computed - billed| / billed; null when billed unknown
  components: ReconstructedComponents;
  warnings: string[];
};

export type ReconstructionInput = {
  rawCalls: RawCall[];
  model: Model; // prices apply (anchor)
  billedPerCall?: (number | null)[]; // optional known billed cost per call, call-order aligned
};

export type ReconstructionResult = {
  perCall: ReconstructedCall[];
  totalComputed: number;
  totalBilled: number | null; // sum of known billed; null if none known
  overallErrorPct: number | null; // |totalComputed - totalBilled| / totalBilled; null if no billed
  passesPhase1: boolean; // true IFF overallErrorPct !== null && overallErrorPct <= 0.05 (deliverable hard gate)
  warnings: string[];
};

// Coerce a raw_usage field to a non-negative finite number; anything else → 0.
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

// Coerce a raw_usage sub-field to a plain object; arrays/null/primitives -> undefined.
function asObject(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

// True iff `key` is PRESENT on `obj` (the value may legitimately be 0). Used by
// the OpenAI/Gemini field-name defensiveness warnings (runbook §4): absent vs
// present-and-zero is the signal — a real no-cache trace carries the field as 0,
// so only an UNDEFINED field is drift-suspect. Anthropic is intentionally NOT
// guarded here (bit-identical Anthropic output is the priority; the parse-side
// readUsageNumber warnings already cover Anthropic field handling).
function hasField(
  obj: Record<string, unknown> | undefined,
  key: string,
): boolean {
  return !!obj && obj[key] !== undefined;
}

// Detect provider from the raw_usage shape (deliverable §3.4).
function detectProvider(raw_usage: Record<string, unknown>): ProviderKind {
  if ("input_tokens" in raw_usage) return "anthropic";
  if ("prompt_tokens" in raw_usage) return "openai";
  if ("usage_metadata" in raw_usage || "cached_content_token_count" in raw_usage) {
    return "gemini";
  }
  return "unknown";
}

function reconstructAnthropicCall(
  raw: RawCall,
  model: Model,
  billed: number | null,
): ReconstructedCall {
  const u = raw.raw_usage;
  const inputTokens = num(u.input_tokens);
  const outputTokens = num(u.output_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheCreate = num(u.cache_creation_input_tokens);
  const reasoningTokens = 0;

  // Anthropic usage does NOT split cache_creation into 5m vs 1h. Split using
  // call_flags.cacheTtlHint (best-effort from response content; default 5m).
  const ttl = raw.call_flags.cacheTtlHint;
  const cacheWrite5mTokens = ttl === "1h" ? 0 : cacheCreate;
  const cacheWrite1hTokens = ttl === "1h" ? cacheCreate : 0;

  // Costs (deliverable §3.2 exact rates):
  //   cache_read   = 0.1× base input → model.cacheReadPricePerM
  //   cache_write 5m = 1.25× base   → model.cacheWritePricePerM
  //   cache_write 1h = 2× base input → 2 * model.inputPricePerM
  //   batch         = 0.5× the whole per-call total (stacks on top)
  const inputCost = (inputTokens / 1e6) * model.inputPricePerM;
  const cacheReadCost = (cacheRead / 1e6) * (model.cacheReadPricePerM ?? 0);
  const cacheWrite5mCost =
    (cacheWrite5mTokens / 1e6) * (model.cacheWritePricePerM ?? 0);
  const cacheWrite1hCost =
    (cacheWrite1hTokens / 1e6) * (2 * model.inputPricePerM);
  const outputCost = (outputTokens / 1e6) * model.outputPricePerM;

  const preBatch =
    inputCost + cacheReadCost + cacheWrite5mCost + cacheWrite1hCost + outputCost;

  // Correction #4: batch = 50% off, stacks on the whole per-call total.
  const isBatch = raw.call_flags.is_batch === true;
  const batchMultiplier = isBatch ? 0.5 : 1;
  const computedCost = preBatch * batchMultiplier;

  const warnings: string[] = [];
  if (isBatch) {
    warnings.push("batch flag set: applied 0.5× batch discount");
  }
  if (model.supportsCache === false && cacheRead + cacheCreate > 0) {
    warnings.push(
      "usage reports cache tokens but model.supportsCache is false — verify pricing",
    );
  }

  const errorPct =
    billed === null || billed === undefined
      ? null
      : Math.abs(computedCost - billed) / billed;

  return {
    provider: "anthropic",
    computedCost,
    billedCost: billed,
    errorPct,
    components: {
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheRead,
      cacheWrite5mTokens,
      cacheWrite1hTokens,
      reasoningTokens,
      inputCost,
      cacheReadCost,
      cacheWrite5mCost,
      cacheWrite1hCost,
      outputCost,
      batchMultiplier,
    },
    warnings,
  };
}

export type CallCostBreakdown = {
  provider: ProviderKind;
  cost: number;
  components: ReconstructedComponents;
  warnings: string[];
};

/**
 * Single-call cost reconstruction shared by reconstructCost (Phase 1) and the
 * replay harness default actualCostFn (Phase 3). Detects provider from the
 * raw_usage shape and prices EVERY provider at the model's REAL
 * cacheReadPricePerM (no guessed multiplier). The Anthropic branch mirrors
 * reconstructAnthropicCall EXACTLY. Unknown shape -> ReconstructError UNKNOWN_PRICING.
 */
export function computeCallCost(
  raw_usage: Record<string, unknown>,
  model: Model,
  callFlags?: { is_batch?: boolean; cacheTtlHint?: "5m" | "1h" },
): CallCostBreakdown {
  const provider = detectProvider(raw_usage);
  const isBatch = callFlags?.is_batch === true;
  const warnings: string[] = [];

  if (provider === "unknown") {
    throw new ReconstructError(
      "cannot reconstruct cost: provider unknown (usage shape unrecognized)",
      "UNKNOWN_PRICING",
    );
  }

  if (provider === "anthropic") {
    // mirrors reconstructAnthropicCall EXACTLY (bit-identical Anthropic numbers).
    const inputTokens = num(raw_usage.input_tokens);
    const outputTokens = num(raw_usage.output_tokens);
    const cacheRead = num(raw_usage.cache_read_input_tokens);
    const cacheCreate = num(raw_usage.cache_creation_input_tokens);
    const ttl = callFlags?.cacheTtlHint;
    const cacheWrite5mTokens = ttl === "1h" ? 0 : cacheCreate;
    const cacheWrite1hTokens = ttl === "1h" ? cacheCreate : 0;
    const inputCost = (inputTokens / 1e6) * model.inputPricePerM;
    const cacheReadCost = (cacheRead / 1e6) * (model.cacheReadPricePerM ?? 0);
    const cacheWrite5mCost =
      (cacheWrite5mTokens / 1e6) * (model.cacheWritePricePerM ?? 0);
    const cacheWrite1hCost =
      (cacheWrite1hTokens / 1e6) * (2 * model.inputPricePerM);
    const outputCost = (outputTokens / 1e6) * model.outputPricePerM;
    const preBatch =
      inputCost + cacheReadCost + cacheWrite5mCost + cacheWrite1hCost + outputCost;
    const batchMultiplier = isBatch ? 0.5 : 1;
    if (isBatch) warnings.push("batch flag set: applied 0.5× batch discount");
    if (model.supportsCache === false && cacheRead + cacheCreate > 0) {
      warnings.push(
        "usage reports cache tokens but model.supportsCache is false — verify pricing",
      );
    }
    return {
      provider,
      cost: preBatch * batchMultiplier,
      components: {
        inputTokens,
        outputTokens,
        cacheReadTokens: cacheRead,
        cacheWrite5mTokens,
        cacheWrite1hTokens,
        reasoningTokens: 0,
        inputCost,
        cacheReadCost,
        cacheWrite5mCost,
        cacheWrite1hCost,
        outputCost,
        batchMultiplier,
      },
      warnings,
    };
  }

  if (provider === "openai") {
    // completion_tokens ALREADY includes reasoning_tokens — surface for
    // transparency, do NOT add to cost (no double-count). Cached tokens live
    // under prompt_tokens_details.cached_tokens.
    const promptTokens = num(raw_usage.prompt_tokens);
    const completionTokens = num(raw_usage.completion_tokens);
    const ptd = asObject(raw_usage.prompt_tokens_details);
    const cachedTokens = num(ptd?.cached_tokens);
    const reasoningTokens = num(
      asObject(raw_usage.completion_tokens_details)?.reasoning_tokens,
    );
    // Field-name defensiveness (runbook §4): cached_tokens is the only
    // bill-changing OpenAI field. Warn when ABSENT (a real no-cache trace carries
    // it as 0 — present-and-zero must stay warning-free). reasoning_tokens is NOT
    // guarded: 0 is a correct non-reasoning value, not a field-name assumption.
    if (!hasField(ptd, "cached_tokens") && promptTokens > 0) {
      warnings.push(
        "OpenAI: prompt_tokens_details.cached_tokens absent — assumed 0 (no cache discount applied). If this trace used prompt caching, verify the field name on the real API response.",
      );
    }
    const nonCachedInput = Math.max(0, promptTokens - cachedTokens);
    const inputCost = (nonCachedInput / 1e6) * model.inputPricePerM;
    const cacheReadCost = (cachedTokens / 1e6) * (model.cacheReadPricePerM ?? 0);
    const outputCost = (completionTokens / 1e6) * model.outputPricePerM;
    const preBatch = inputCost + cacheReadCost + outputCost;
    const batchMultiplier = isBatch ? 0.5 : 1; // OpenAI Batch IS 50% off
    if (isBatch) warnings.push("batch flag set: applied 0.5× batch discount");
    if (model.supportsCache === false && cachedTokens > 0) {
      warnings.push(
        "usage reports cache tokens but model.supportsCache is false — verify pricing",
      );
    }
    return {
      provider,
      cost: preBatch * batchMultiplier,
      components: {
        inputTokens: nonCachedInput,
        outputTokens: completionTokens,
        cacheReadTokens: cachedTokens,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        reasoningTokens,
        inputCost,
        cacheReadCost,
        cacheWrite5mCost: 0,
        cacheWrite1hCost: 0,
        outputCost,
        batchMultiplier,
      },
      warnings,
    };
  }

  // provider === "gemini": counts live under usage_metadata (fall back to a flat
  // raw_usage). thoughts_token_count is SEPARATE from candidates, billed at the
  // OUTPUT rate — ADD them. Gemini has NO 50% batch discount.
  const um = asObject(raw_usage.usage_metadata) ?? raw_usage;
  const promptTokens = num(um.prompt_token_count);
  const candidatesTokens = num(um.candidates_token_count);
  const cachedTokens = num(um.cached_content_token_count);
  const thoughtsTokens = num(um.thoughts_token_count);
  // Field-name defensiveness (runbook §4): cached_content_token_count and
  // thoughts_token_count are the drift-prone bill-changing Gemini fields. Warn
  // when ABSENT (present-and-zero is a legitimate no-cache/no-thinking value and
  // must stay warning-free). Guard on prompt/candidates > 0 to skip degenerate
  // empty traces.
  if (!hasField(um, "cached_content_token_count") && promptTokens > 0) {
    warnings.push(
      "Gemini: cached_content_token_count absent — assumed 0 (no cache discount applied). If this trace used implicit caching, verify the field name.",
    );
  }
  if (!hasField(um, "thoughts_token_count") && candidatesTokens > 0) {
    warnings.push(
      "Gemini: thoughts_token_count absent — assumed 0 (output under-counted). If the model used thinking, verify the field name.",
    );
  }
  const nonCachedInput = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (nonCachedInput / 1e6) * model.inputPricePerM;
  const cacheReadCost = (cachedTokens / 1e6) * (model.cacheReadPricePerM ?? 0);
  const outputTokens = candidatesTokens + thoughtsTokens;
  const outputCost = (outputTokens / 1e6) * model.outputPricePerM;
  const preBatch = inputCost + cacheReadCost + outputCost;
  const batchMultiplier = 1; // Gemini has NO batch discount
  if (isBatch) {
    warnings.push(
      "is_batch set but Gemini has no batch discount — multiplier stays 1×",
    );
  }
  if (model.supportsCache === false && cachedTokens > 0) {
    warnings.push(
      "usage reports cache tokens but model.supportsCache is false — verify pricing",
    );
  }
  return {
    provider,
    cost: preBatch * batchMultiplier,
    components: {
      inputTokens: nonCachedInput,
      outputTokens,
      cacheReadTokens: cachedTokens,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      reasoningTokens: thoughtsTokens,
      inputCost,
      cacheReadCost,
      cacheWrite5mCost: 0,
      cacheWrite1hCost: 0,
      outputCost,
      batchMultiplier,
    },
    warnings,
  };
}

function reconstructOpenAICall(
  raw: RawCall,
  model: Model,
  billed: number | null,
): ReconstructedCall {
  const { cost, components, warnings } = computeCallCost(raw.raw_usage, model, {
    is_batch: raw.call_flags.is_batch,
    cacheTtlHint: raw.call_flags.cacheTtlHint,
  });
  const errorPct =
    billed === null || billed === undefined
      ? null
      : Math.abs(cost - billed) / billed;
  return {
    provider: "openai",
    computedCost: cost,
    billedCost: billed,
    errorPct,
    components,
    warnings,
  };
}

function reconstructGeminiCall(
  raw: RawCall,
  model: Model,
  billed: number | null,
): ReconstructedCall {
  const { cost, components, warnings } = computeCallCost(raw.raw_usage, model, {
    is_batch: raw.call_flags.is_batch,
    cacheTtlHint: raw.call_flags.cacheTtlHint,
  });
  const errorPct =
    billed === null || billed === undefined
      ? null
      : Math.abs(cost - billed) / billed;
  return {
    provider: "gemini",
    computedCost: cost,
    billedCost: billed,
    errorPct,
    components,
    warnings,
  };
}

export function reconstructCost(
  input: ReconstructionInput,
): ReconstructionResult {
  const perCall = input.rawCalls.map((raw, i) => {
    if (!raw || !raw.raw_usage || typeof raw.raw_usage !== "object") {
      throw new ReconstructError(`Call ${i + 1}: missing raw_usage`, "NO_RAW_USAGE");
    }
    const provider = detectProvider(raw.raw_usage);
    const billed = input.billedPerCall?.[i] ?? null;
    if (provider === "anthropic") {
      return reconstructAnthropicCall(raw, input.model, billed);
    }
    if (provider === "openai") {
      return reconstructOpenAICall(raw, input.model, billed);
    }
    if (provider === "gemini") {
      return reconstructGeminiCall(raw, input.model, billed);
    }
    throw new ReconstructError(
      `Call ${i + 1}: provider '${provider}' reconstruction not implemented (usage shape unrecognized)`,
      "UNKNOWN_PRICING",
    );
  });

  const totalComputed = perCall.reduce((sum, c) => sum + c.computedCost, 0);
  const knownBilled = perCall
    .filter((c) => c.billedCost !== null)
    .map((c) => c.billedCost as number);
  const totalBilled =
    knownBilled.length === 0 ? null : knownBilled.reduce((a, b) => a + b, 0);
  const overallErrorPct =
    totalBilled === null
      ? null
      : Math.abs(totalComputed - totalBilled) / totalBilled;
  const passesPhase1 = overallErrorPct !== null && overallErrorPct <= 0.05;

  return {
    perCall,
    totalComputed,
    totalBilled,
    overallErrorPct,
    passesPhase1,
    warnings: perCall.flatMap((c) => c.warnings),
  };
}
