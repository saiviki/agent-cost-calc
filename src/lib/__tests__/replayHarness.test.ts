// Phase 3 end-to-end replay HARNESS tests (docs/SPEC-phase3-replay.md §7).
// HONESTY (P4): this harness makes ZERO live network calls. The empirical Phase 3
// result (median <=5% / P95 <=8-10% on >=20 REAL model-B calls) is NOT claimed
// here — it requires the operator to run buildReplayPlan against real model B
// with their own API key and feed the actual raw_usage into evaluateReplay. These
// tests prove the HARNESS with SYNTHETIC operator-supplied actual-usage fixtures.
//
// Hard-coded test Models (price-stable, house style — read from src/lib/models.ts [V]):
//   gpt-5.5           (OpenAI):  inputPricePerM = 5.0,  outputPricePerM = 30.0   [exact o200k tokenizer]
//   claude-sonnet-4-6 (Anthropic): inputPricePerM = 3.0, outputPricePerM = 15.0,
//                                  cacheReadPricePerM = 0.30, cacheWritePricePerM = 3.75 [approx ~3.5 chars/tok]
//
// REAL o200k token counts (gpt-tokenizer o200k_base, probed via node -e) [V]:
//   'Refactor the auth module to use JWT.'
//        -> prompt 9 ; 'Refactored: replaced session cookies with signed JWTs in lib/auth.ts.'
//        -> completion 16
//   'Write a unit test for the rate limiter.'
//        -> prompt 9 ; 'Added vitest cases for the token-bucket overflow and idle-refill paths.'
//        -> completion 16
import { describe, it, expect } from "vitest";
import {
  buildReplayPlan,
  evaluateReplay,
  median,
  p95,
  ReplayError,
  type ActualCostFn,
} from "../replayHarness";
import { computeCallCost } from "../reconstructCost";
import { MODELS } from "../models";
import type { RawCall } from "../parseTrace";

const gpt55 = MODELS.find((m) => m.id === "gpt-5.5")!;
const sonnet46 = MODELS.find((m) => m.id === "claude-sonnet-4-6")!;

const PROMPT_A = "Refactor the auth module to use JWT."; // o200k prompt = 9 [V]
const COMPLETION_A =
  "Refactored: replaced session cookies with signed JWTs in lib/auth.ts."; // o200k = 16 [V]
const PROMPT_B = "Write a unit test for the rate limiter."; // o200k prompt = 9 [V]
const COMPLETION_B =
  "Added vitest cases for the token-bucket overflow and idle-refill paths."; // o200k = 16 [V]

// num() mirror of the harness's internal coercion (used by the case-4 actualCostFn stub).
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function makeCall(
  over: Partial<RawCall> & { raw_usage?: Record<string, unknown> } = {},
): RawCall {
  return {
    raw_usage: { input_tokens: 1000, output_tokens: 6, ...(over.raw_usage ?? {}) },
    full_text_content: {
      promptText: "",
      completionText: COMPLETION_A,
      ...(over.full_text_content ?? {}),
    },
    call_flags: { model: "claude-sonnet-4-6", provider: "anthropic" },
    ...over,
  };
}

// Two-call plan WITH promptText on both (for exact-pass / degrade tests).
function twoPromptCalls(): RawCall[] {
  return [
    makeCall({
      full_text_content: { promptText: PROMPT_A, completionText: COMPLETION_A },
    }),
    makeCall({
      full_text_content: { promptText: PROMPT_B, completionText: COMPLETION_B },
    }),
  ];
}

describe("median + p95 (documented statistics)", () => {
  it("median: odd middle, even mean, empty -> 0", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("p95: nearest-rank, empty -> 0", () => {
    // ceil(0.95*20) = 19 -> 1-indexed rank 19 -> 0-indexed 18 -> value 19
    expect(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])).toBe(19);
    expect(p95([])).toBe(0);
  });
});

describe("buildReplayPlan", () => {
  it("adapts rawCalls to ReplayItems; flags response-only + always warns tool schema gap", () => {
    const plan = buildReplayPlan(
      [
        makeCall({ full_text_content: { promptText: PROMPT_A, completionText: COMPLETION_A } }),
        makeCall({ full_text_content: { promptText: "", completionText: COMPLETION_B } }),
      ],
      gpt55,
    );

    expect(plan.targetModelId).toBe("gpt-5.5");
    expect(plan.targetProvider).toBe("OpenAI");
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0].promptText).toBe(PROMPT_A);
    expect(plan.items[1].promptText).toBe("");
    expect(plan.items[1].notes.some((n) => n.includes("no prompt text"))).toBe(true);
    expect(plan.items[0].notes.some((n) => n.includes("no prompt text"))).toBe(false);
    // Tool-schema gap is ALWAYS warned (residual per deliverable 3.3).
    expect(plan.warnings.some((w) => w.includes("tool schema"))).toBe(true);
    // Partial-input warning because at least one call is response-only.
    expect(plan.warnings.some((w) => w.includes("input-side replay is partial"))).toBe(true);
  });
});

describe("evaluateReplay — EXACT pass (gpt-5.5, actualCostFn stub, real o200k counts)", () => {
  it("input-side diff ~0 when actual input_tokens === real o200k prompt count; gate input, exact", () => {
    const plan = buildReplayPlan(twoPromptCalls(), gpt55);
    // Actuals mirror B's real usage with input_tokens === real o200k prompt count (9),
    // output_tokens === real o200k completion count (16). Billed at OpenAI list rates
    // via a supplied actualCostFn (gpt-5.5 is non-Anthropic -> fn required).
    const openaiCost: ActualCostFn = (u, m) =>
      num(u.prompt_tokens) / 1e6 * m.inputPricePerM +
      num(u.completion_tokens) / 1e6 * m.outputPricePerM;
    const actuals = [
      { usage: { prompt_tokens: 9, completion_tokens: 16 } },
      { usage: { prompt_tokens: 9, completion_tokens: 16 } },
    ];

    const evaluation = evaluateReplay(plan, actuals, gpt55, openaiCost);

    expect(evaluation.sampleSize).toBe(2);
    expect(evaluation.gateBasis).toBe("input");
    expect(evaluation.method).toBe("exact");
    expect(evaluation.inputTokenDiffMedianPct).toBeCloseTo(0, 10);
    expect(evaluation.inputTokenDiffP95Pct).toBeCloseTo(0, 10);
    expect(evaluation.passesPhase3).toBe(true);
  });
});

describe("evaluateReplay — DEGRADE fail (actual input_tokens = round(real*1.20))", () => {
  it("median reflects the honest diff and the gate fails", () => {
    const plan = buildReplayPlan(twoPromptCalls(), gpt55);
    const openaiCost: ActualCostFn = (u, m) =>
      num(u.prompt_tokens) / 1e6 * m.inputPricePerM +
      num(u.completion_tokens) / 1e6 * m.outputPricePerM;
    // actInput = round(9 * 1.20) = round(10.8) = 11.
    const actuals = [
      { usage: { prompt_tokens: 11, completion_tokens: 16 } },
      { usage: { prompt_tokens: 11, completion_tokens: 16 } },
    ];

    const evaluation = evaluateReplay(plan, actuals, gpt55, openaiCost);

    // HONEST value under the load-bearing formula |cf-act|/act:
    //   cf=9, act=11 -> |9-11|/11 = 2/11 ~= 0.1818.
    // NOTE (P4): the brief's literal "0.20 within ~0.01" is mathematically
    // UNATTAINABLE here. Under |cf-act|/act, a 1.20x degradation asymptotes to
    // 0.20/1.20 = 0.1667 as counts grow; with cf=9 the rounding to 11 gives 0.1818.
    // We assert the real formula output rather than the brief's unevaluated 0.20.
    expect(evaluation.inputTokenDiffMedianPct).toBeCloseTo(2 / 11, 4);
    expect(evaluation.inputTokenDiffP95Pct).toBeCloseTo(2 / 11, 4);
    expect(evaluation.passesPhase3).toBe(false);
    expect(evaluation.gateBasis).toBe("input");
  });
});

describe("evaluateReplay — Anthropic default actualCost (sonnet, no fn)", () => {
  it("pairs[0].actualCost === hand-computed anthropic default cost (computeCallCost); method approx", () => {
    const plan = buildReplayPlan(twoPromptCalls(), sonnet46);
    const actuals = [
      { usage: { input_tokens: 1000, output_tokens: 6 } },
      { usage: { input_tokens: 1000, output_tokens: 6 } },
    ];

    const evaluation = evaluateReplay(plan, actuals, sonnet46);

    // Hand-computed actual cost via computeCallCost (anthropic, no cache, no batch):
    //   1000/1e6 * 3.0 + 6/1e6 * 15.0 = 0.003 + 0.00009 = 0.00309 [V]
    expect(evaluation.pairs[0].actualCost).toBeCloseTo(0.00309, 10);
    // Default now delegates to computeCallCost (de-dup; anthropicActualCost removed).
    // The anthropic branch mirrors reconstructAnthropicCall, so no-cache/no-batch is bit-identical.
    expect(evaluation.pairs[0].actualCost).toBe(
      computeCallCost({ input_tokens: 1000, output_tokens: 6 }, sonnet46).cost,
    );
    // Sonnet has no client-side tokenizer -> approx.
    expect(evaluation.method).toBe("approx");
    expect(evaluation.pairs[0].method).toBe("approx");
  });
});

describe("evaluateReplay — error paths", () => {
  it("SUCCEEDS for a gpt-5.5 target with NO actualCostFn (default delegates to computeCallCost)", () => {
    const plan = buildReplayPlan(twoPromptCalls(), gpt55);
    const actuals = [
      { usage: { prompt_tokens: 9, completion_tokens: 16 } },
      { usage: { prompt_tokens: 9, completion_tokens: 16 } },
    ];
    // No throw: default actualCost now delegates to computeCallCost (OpenAI branch).
    const evaluation = evaluateReplay(plan, actuals, gpt55);
    // Real actualCost: 9/1e6*5.0 + 16/1e6*30.0 = 0.000045 + 0.00048 = 0.000525 [V]
    expect(evaluation.pairs[0].actualCost).toBeCloseTo(0.000525, 10);
    expect(evaluation.pairs[0].actualCost).toBe(
      computeCallCost({ prompt_tokens: 9, completion_tokens: 16 }, gpt55).cost,
    );
  });

  it("SUCCEEDS for a gemini-3.1-pro target with NO actualCostFn (default delegates to computeCallCost)", () => {
    const gemini31pro = MODELS.find((m) => m.id === "gemini-3.1-pro")!;
    const plan = buildReplayPlan(twoPromptCalls(), gemini31pro);
    const actuals = [
      { usage: { usage_metadata: { prompt_token_count: 9, candidates_token_count: 16, thoughts_token_count: 0 } } },
      { usage: { usage_metadata: { prompt_token_count: 9, candidates_token_count: 16, thoughts_token_count: 0 } } },
    ];
    const evaluation = evaluateReplay(plan, actuals, gemini31pro);
    // Real actualCost: 9/1e6*2.0 + 16/1e6*12.0 = 0.000018 + 0.000192 = 0.00021 [V]
    expect(evaluation.pairs[0].actualCost).toBeCloseTo(0.00021, 10);
    expect(evaluation.pairs[0].actualCost).toBe(
      computeCallCost(
        { usage_metadata: { prompt_token_count: 9, candidates_token_count: 16, thoughts_token_count: 0 } },
        gemini31pro,
      ).cost,
    );
  });

  it("throws ReplayError LENGTH_MISMATCH when actuals.length !== items.length", () => {
    const plan = buildReplayPlan(twoPromptCalls(), sonnet46);
    // 2 items, only 1 actual.
    try {
      evaluateReplay(plan, [{ usage: { input_tokens: 1, output_tokens: 1 } }], sonnet46);
      throw new Error("expected evaluateReplay to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ReplayError);
      expect((e as ReplayError).code).toBe("LENGTH_MISMATCH");
    }
  });
});

describe("evaluateReplay — warnings", () => {
  it("warns on sample size < 20", () => {
    const plan = buildReplayPlan(twoPromptCalls(), sonnet46);
    const actuals = [
      { usage: { input_tokens: 1000, output_tokens: 6 } },
      { usage: { input_tokens: 1000, output_tokens: 6 } },
    ];
    const evaluation = evaluateReplay(plan, actuals, sonnet46);
    expect(evaluation.warnings.some((w) => w.includes("sample size"))).toBe(true);
  });

  it("response-only (no promptText) -> input median null, gateBasis cost, COST-diff warning", () => {
    // Both calls response-only: promptText === "".
    const calls: RawCall[] = [
      makeCall({ full_text_content: { promptText: "", completionText: COMPLETION_A } }),
      makeCall({ full_text_content: { promptText: "", completionText: COMPLETION_B } }),
    ];
    const plan = buildReplayPlan(calls, sonnet46);
    const actuals = [
      { usage: { input_tokens: 1, output_tokens: 1 } },
      { usage: { input_tokens: 1, output_tokens: 1 } },
    ];
    const evaluation = evaluateReplay(plan, actuals, sonnet46);

    expect(evaluation.inputTokenDiffMedianPct).toBeNull();
    expect(evaluation.inputTokenDiffP95Pct).toBeNull();
    expect(evaluation.gateBasis).toBe("cost");
    expect(evaluation.warnings.some((w) => w.includes("COST diff"))).toBe(true);
  });
});
