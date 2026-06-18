// Phase 2 cost layer (docs/RESEARCH-validation-methodology.md §4.3, §3.2).
// Given captured rawCalls and a set of target models, compute the cost of the
// captured run re-tokenized under each target's tokenizer, priced at that
// target's list rates. NO cache, NO batch (counterfactual default per
// deliverable §3.2). Models the TOKENIZER effect on the SAME captured output
// text only — NOT model verbosity (that is Phase 3 replay). For OpenAI targets
// counts are exact (gpt-tokenizer); for Anthropic/Gemini they are a flagged
// char-ratio approximation. Never reads the model verbosity multiplier (the
// heuristic this layer replaces) — countTokens is the only cross-model bridge.

import type { Model } from "./models";
import { MODELS } from "./models";
import type { RawCall } from "./parseTrace";
import { countTokens, type TokenizerMethod } from "./tokenize";

export type RetokenizedCostRow = {
  model: Model;
  runs: number; // rawCalls.length
  totalCost: number; // sum over captured calls, no cache/batch
  perRunCost: number; // totalCost / runs
  targetOutputTokens: number; // sum of re-tokenized completionText across calls
  targetInputTokens: number | null; // sum of re-tokenized promptText; null when NO call had promptText (response-only trace)
  method: TokenizerMethod; // worst-case: 'approx' if any call approx, else 'exact'
  isExact: boolean; // method === 'exact'
  notes: string[]; // honesty flags
};

export function projectRetokenized(
  rawCalls: RawCall[],
  models?: Model[],
): RetokenizedCostRow[] {
  const set = models ?? MODELS;
  if (rawCalls.length === 0) return []; // guard
  const runs = rawCalls.length;
  return set
    .map((model) => {
      let totalOutputTokens = 0;
      let totalInputTokens = 0;
      let anyPromptText = false;
      let anyApprox = false;
      for (const raw of rawCalls) {
        const completionText = raw.full_text_content?.completionText ?? "";
        const promptText = raw.full_text_content?.promptText ?? "";
        const out = countTokens(completionText, model.id, model.provider);
        totalOutputTokens += out.count;
        if (out.method === "approx") anyApprox = true;
        if (promptText.length > 0) {
          anyPromptText = true;
          const inp = countTokens(promptText, model.id, model.provider);
          totalInputTokens += inp.count;
          if (inp.method === "approx") anyApprox = true;
        }
      }
      // Cost: no cache, no batch (counterfactual default). Input cost only
      // computable when promptText was captured.
      const outputCost = (totalOutputTokens / 1e6) * model.outputPricePerM;
      const inputCost = anyPromptText
        ? (totalInputTokens / 1e6) * model.inputPricePerM
        : 0;
      const totalCost = outputCost + inputCost;
      const method: TokenizerMethod = anyApprox ? "approx" : "exact";
      const notes: string[] = [];
      if (method === "approx")
        notes.push(
          `${model.name}: approx tokenization (no official client-side Claude 4.x/Gemini tokenizer) — ±20-30%. Not a billed-accuracy claim.`,
        );
      if (!anyPromptText)
        notes.push(
          "No prompt text captured (response-only trace) — input-side cost omitted; output-side only.",
        );
      return {
        model,
        runs,
        totalCost,
        perRunCost: totalCost / runs,
        targetOutputTokens: totalOutputTokens,
        targetInputTokens: anyPromptText ? totalInputTokens : null,
        method,
        isExact: method === "exact",
        notes,
      };
    })
    .sort((a, b) => a.totalCost - b.totalCost);
}
