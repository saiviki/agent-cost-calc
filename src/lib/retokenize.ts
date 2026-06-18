// Phase 2 cross-model re-tokenization (docs/RESEARCH-validation-methodology.md §4.3).
// Given captured rawCalls (Phase 1 ground truth) and a TARGET model, re-tokenize
// the captured prompt + completion text with the target's tokenizer to get
// accurate cross-model token counts. This REPLACES the heuristic outputMultiplier
// as the cross-model bridge. retokenize.ts never reads model.outputMultiplier.

import type { Model } from "./models";
import type { RawCall } from "./parseTrace";
import {
  countTokens,
  tokenizerFamilyForModel,
  type TokenizerFamily,
  type TokenizerMethod,
} from "./tokenize";

export type PerCallRetokenization = {
  index: number;
  hasPromptText: boolean; // false for response-only traces (no prompt captured)
  sourcePromptTokens: number | null; // from raw_usage (Anthropic input_tokens / OpenAI prompt_tokens) — the ORIGINAL model's count
  targetPromptTokens: number | null; // re-tokenized with the target tokenizer; null when no promptText captured
  promptDiffPct: number | null; // (target - source)/source; null when either side missing
  sourceCompletionTokens: number; // from raw_usage.output_tokens
  targetCompletionTokens: number; // re-tokenized completionText
  completionDiffPct: number; // (target - source)/source
  method: TokenizerMethod; // "exact" for OpenAI target, "approx" for Anthropic/Gemini target
};

export type RetokenizationResult = {
  targetModelId: string;
  targetFamily: string;
  method: TokenizerMethod; // aggregate (worst-case): "approx" if ANY call is approx, else "exact"
  perCall: PerCallRetokenization[];
  totalSourceInputTokens: number; // sum of source input-side (only where comparable)
  totalTargetInputTokens: number;
  totalSourceOutputTokens: number;
  totalTargetOutputTokens: number;
  outputDiffPct: number; // aggregate output diff (the primary cross-model signal)
  inputDiffPct: number | null; // null if no promptText captured for any call
  notes: string[]; // honesty flags (approx families, missing promptText, etc.)
};

// Coerce a raw_usage field to a non-negative finite number; anything else → 0.
// Mirrors reconstructCost.ts's num().
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

// Best-effort source tokenizer family for a captured call, so we can flag
// same-family comparisons (within-family drift expected <5%). Returns null when
// the call carries neither a model id nor a recognized provider.
function sourceFamilyFromCall(raw: RawCall): TokenizerFamily | null {
  const model = raw.call_flags.model;
  const prov = raw.call_flags.provider;
  const displayProvider =
    prov === "anthropic"
      ? "Anthropic"
      : prov === "openai"
        ? "OpenAI"
        : prov === "gemini"
          ? "Google"
          : "";
  if (!model && !displayProvider) return null;
  return tokenizerFamilyForModel(model ?? "", displayProvider);
}

// Read the ORIGINAL model's input-side token count from raw_usage.
// Anthropic: input_tokens. OpenAI: prompt_tokens. null when neither is present.
function sourceInputTokens(raw_usage: Record<string, unknown>): number | null {
  if ("input_tokens" in raw_usage) return num(raw_usage.input_tokens);
  if ("prompt_tokens" in raw_usage) return num(raw_usage.prompt_tokens);
  return null;
}

export function retokenizeRun(
  rawCalls: RawCall[],
  target: Model,
): RetokenizationResult {
  const targetFamily = tokenizerFamilyForModel(target.id, target.provider);

  const perCall: PerCallRetokenization[] = [];
  let totalSourceInput = 0;
  let totalTargetInput = 0;
  let totalSourceOutput = 0;
  let totalTargetOutput = 0;
  let anyApprox = false;
  let anyPromptText = false;
  let anySameFamily = false;

  rawCalls.forEach((raw, index) => {
    const ftc = raw.full_text_content;
    const completionText = ftc?.completionText ?? "";
    const promptText = ftc?.promptText ?? "";
    const hasPromptText = promptText.length > 0;

    const srcOut = num(raw.raw_usage.output_tokens);
    const srcIn = sourceInputTokens(raw.raw_usage);

    const tgtCompletion = countTokens(completionText, target.id, target.provider);
    const tgtPrompt = hasPromptText
      ? countTokens(promptText, target.id, target.provider)
      : null;

    if (tgtCompletion.method === "approx") anyApprox = true;
    if (tgtPrompt && tgtPrompt.method === "approx") anyApprox = true;
    if (hasPromptText) anyPromptText = true;

    const srcFam = sourceFamilyFromCall(raw);
    if (srcFam !== null && srcFam === targetFamily) anySameFamily = true;

    const completionDiffPct =
      srcOut === 0 ? 0 : (tgtCompletion.count - srcOut) / srcOut;
    const promptDiffPct =
      tgtPrompt !== null && srcIn !== null && srcIn > 0
        ? (tgtPrompt.count - srcIn) / srcIn
        : null;

    totalSourceOutput += srcOut;
    totalTargetOutput += tgtCompletion.count;
    if (srcIn !== null) totalSourceInput += srcIn;
    if (tgtPrompt !== null) totalTargetInput += tgtPrompt.count;

    const callMethod: TokenizerMethod =
      tgtCompletion.method === "approx" || tgtPrompt?.method === "approx"
        ? "approx"
        : "exact";

    perCall.push({
      index,
      hasPromptText,
      sourcePromptTokens: srcIn,
      targetPromptTokens: tgtPrompt?.count ?? null,
      promptDiffPct,
      sourceCompletionTokens: srcOut,
      targetCompletionTokens: tgtCompletion.count,
      completionDiffPct,
      method: callMethod,
    });
  });

  const outputDiffPct =
    totalSourceOutput === 0
      ? 0
      : (totalTargetOutput - totalSourceOutput) / totalSourceOutput;
  const inputDiffPct =
    !anyPromptText || totalSourceInput === 0
      ? null
      : (totalTargetInput - totalSourceInput) / totalSourceInput;

  const method: TokenizerMethod = anyApprox ? "approx" : "exact";

  const notes: string[] = [];
  if (method === "approx") {
    notes.push(
      `${target.name}: no official client-side tokenizer — counts are a char-ratio approximation (±20-30%). Not a billed-accuracy claim.`,
    );
  }
  if (!anyPromptText) {
    notes.push(
      "No prompt text captured (response-only trace) — input-side re-tokenization unavailable; only output-side diff is computed.",
    );
  }
  if (anySameFamily) {
    notes.push(
      "same-family comparison: within-family tokenizer drift expected <5%",
    );
  }

  return {
    targetModelId: target.id,
    targetFamily,
    method,
    perCall,
    totalSourceInputTokens: totalSourceInput,
    totalTargetInputTokens: totalTargetInput,
    totalSourceOutputTokens: totalSourceOutput,
    totalTargetOutputTokens: totalTargetOutput,
    outputDiffPct,
    inputDiffPct,
    notes,
  };
}
