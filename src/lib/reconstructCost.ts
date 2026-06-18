// Phase 1 reconstruction harness. Implements docs/RESEARCH-validation-methodology.md §4.2.
// Re-derives billed cost from provider raw_usage (GROUND TRUTH) + correct Anthropic
// cache/batch rules, for comparison against actual invoice. Does NOT use the
// heuristic outputMultiplier — this is the deliverable's hard-rule foundation.
// Provider support: Anthropic fully correct (what parseTrace ingests today).
// OpenAI/Gemini are DETECTED but throw UnsupportedProvider — we do not guess
// their model-specific cached rates (deliverable §3.4 'do not guess').

import type { Model } from "./models";
import type { RawCall } from "./parseTrace";

export type ProviderKind = "anthropic" | "openai" | "gemini" | "unknown";

export class ReconstructError extends Error {
  constructor(
    message: string,
    public readonly code: "UNSUPPORTED_PROVIDER" | "NO_RAW_USAGE" | "UNKNOWN_PRICING",
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
    throw new ReconstructError(
      `Call ${i + 1}: provider '${provider}' reconstruction not implemented — parseTrace does not yet ingest this format and we do not guess its cache rates`,
      "UNSUPPORTED_PROVIDER",
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
