// Phase 1 reconstruction harness tests. Implements docs/SPEC-phase1-reconstruction.md §4.
// All values are hand-computed and asserted to 6 decimal places. The test Models
// are hard-coded (Sonnet 4.6, GPT-5.5, Gemini 3.1 Pro prices) so the suite is
// price-stable across MODELS edits (house style: SPEC-effective-cost.md §5).
import { describe, it, expect } from "vitest";
import { reconstructCost, ReconstructError } from "../reconstructCost";
import type { RawCall } from "../parseTrace";
import type { Model } from "../models";

// Hard-coded Sonnet 4.6 test model (NOT imported from MODELS — price-stable).
const sonnetModel: Model = {
  id: "claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  provider: "Anthropic",
  isOpen: false,
  tier: "mid",
  strengths: ["coding", "general"],
  contextK: 200,
  inputPricePerM: 3.0,
  outputPricePerM: 15.0,
  cacheReadPricePerM: 0.3,
  cacheWritePricePerM: 3.75,
  supportsCache: true,
  outputMultiplier: 1.0,
};

// Hard-coded GPT-5.5 test model (OpenAI; REAL prices mirrored from MODELS) [V].
const gpt55Model: Model = {
  id: "gpt-5.5",
  name: "GPT-5.5",
  provider: "OpenAI",
  isOpen: false,
  tier: "frontier",
  strengths: ["reasoning"],
  contextK: 1050,
  inputPricePerM: 5.0,
  outputPricePerM: 30.0,
  cacheReadPricePerM: 0.5,
  supportsCache: true,
  outputMultiplier: 5.4,
};

// Hard-coded Gemini 3.1 Pro test model (Google; REAL prices mirrored from MODELS) [V].
const geminiModel: Model = {
  id: "gemini-3.1-pro",
  name: "Gemini 3.1 Pro",
  provider: "Google",
  isOpen: false,
  tier: "frontier",
  strengths: ["multimodal", "long-context", "reasoning"],
  contextK: 1048,
  inputPricePerM: 2.0,
  outputPricePerM: 12.0,
  cacheReadPricePerM: 0.2,
  supportsCache: true,
  outputMultiplier: 4.1,
};

describe("reconstructCost — Anthropic rates", () => {
  // Case 1 — single call, no cache. computedCost = 1000/1e6*3 + 250/1e6*15 = 0.003 + 0.00375 = 0.00675
  it("computes a single Anthropic call with no cache", () => {
    const rawCall: RawCall = {
      raw_usage: {
        input_tokens: 1000,
        output_tokens: 250,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      call_flags: { provider: "anthropic" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    expect(result.perCall).toHaveLength(1);
    expect(result.perCall[0].computedCost).toBeCloseTo(0.00675, 6);
    expect(result.perCall[0].components.inputCost).toBeCloseTo(0.003, 6);
    expect(result.perCall[0].components.outputCost).toBeCloseTo(0.00375, 6);
    expect(result.perCall[0].components.batchMultiplier).toBe(1);
    expect(result.perCall[0].errorPct).toBeNull();
  });

  // Case 2 — cache tiers, default 5m TTL.
  // input 2000×3/1e6=0.006 + cacheRead 8000×0.30/1e6=0.0024 + write5m 1000×3.75/1e6=0.00375 + output 400×15/1e6=0.006 = 0.01815
  it("computes cache tiers with the default 5m TTL", () => {
    const rawCall: RawCall = {
      raw_usage: {
        input_tokens: 2000,
        output_tokens: 400,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 1000,
      },
      call_flags: { provider: "anthropic" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    const c = result.perCall[0];
    expect(c.components.inputCost).toBeCloseTo(0.006, 6);
    expect(c.components.cacheReadCost).toBeCloseTo(0.0024, 6);
    expect(c.components.cacheWrite5mCost).toBeCloseTo(0.00375, 6);
    expect(c.components.cacheWrite1hCost).toBeCloseTo(0, 6);
    expect(c.components.outputCost).toBeCloseTo(0.006, 6);
    expect(c.computedCost).toBeCloseTo(0.01815, 6);
  });

  // Case 3 — 1h TTL. write5m=0, write1h = 1000/1e6*(2*3.00) = 0.006.
  // total = 0.006 + 0.0024 + 0 + 0.006 + 0.006 = 0.0204
  it("routes cache creation to the 1h tier when cacheTtlHint is 1h", () => {
    const rawCall: RawCall = {
      raw_usage: {
        input_tokens: 2000,
        output_tokens: 400,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 1000,
      },
      call_flags: { provider: "anthropic", cacheTtlHint: "1h" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    const c = result.perCall[0];
    expect(c.components.cacheWrite5mCost).toBeCloseTo(0, 6);
    expect(c.components.cacheWrite1hCost).toBeCloseTo(0.006, 6);
    expect(c.computedCost).toBeCloseTo(0.0204, 6);
  });

  // Case 4 — batch. computedCost = 0.01815 * 0.5 = 0.009075; batchMultiplier 0.5; warns.
  it("applies the 0.5× batch discount and warns", () => {
    const rawCall: RawCall = {
      raw_usage: {
        input_tokens: 2000,
        output_tokens: 400,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 1000,
      },
      call_flags: { provider: "anthropic", is_batch: true },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    const c = result.perCall[0];
    expect(c.components.batchMultiplier).toBeCloseTo(0.5, 6);
    expect(c.computedCost).toBeCloseTo(0.009075, 6);
    expect(c.warnings.some((w) => w.includes("batch"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("batch"))).toBe(true);
  });
});

describe("reconstructCost — OpenAI rates (gpt-5.5)", () => {
  // Case O1 — non-cached input + cached read + output. completion_tokens already
  // includes reasoning (800) — surfaced, NOT added to cost.
  // input 4000/1e6*5.0=0.020 + cacheRead 6000/1e6*0.50=0.003 + output 2000/1e6*30.0=0.060 = 0.083
  it("computes an OpenAI gpt-5.5 call without double-counting reasoning", () => {
    const rawCall: RawCall = {
      raw_usage: {
        prompt_tokens: 10000,
        completion_tokens: 2000,
        prompt_tokens_details: { cached_tokens: 6000 },
        completion_tokens_details: { reasoning_tokens: 800 },
      },
      call_flags: { provider: "openai" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: gpt55Model });
    const c = result.perCall[0];
    expect(c.provider).toBe("openai");
    expect(c.components.inputCost).toBeCloseTo(0.02, 6);
    expect(c.components.cacheReadCost).toBeCloseTo(0.003, 6);
    expect(c.components.outputCost).toBeCloseTo(0.06, 6);
    expect(c.components.reasoningTokens).toBe(800);
    expect(c.components.cacheWrite5mTokens).toBe(0);
    expect(c.components.batchMultiplier).toBe(1);
    expect(c.computedCost).toBeCloseTo(0.083, 6);
    expect(c.errorPct).toBeNull();
  });

  // Case O2 — batch: 0.083 * 0.5 = 0.0415; OpenAI Batch IS 50% off.
  it("applies the 0.5× batch discount for OpenAI (is_batch true)", () => {
    const rawCall: RawCall = {
      raw_usage: {
        prompt_tokens: 10000,
        completion_tokens: 2000,
        prompt_tokens_details: { cached_tokens: 6000 },
        completion_tokens_details: { reasoning_tokens: 800 },
      },
      call_flags: { provider: "openai", is_batch: true },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: gpt55Model });
    const c = result.perCall[0];
    expect(c.components.batchMultiplier).toBe(0.5);
    expect(c.computedCost).toBeCloseTo(0.0415, 6);
    expect(c.warnings.some((w) => w.includes("batch"))).toBe(true);
  });
});

describe("reconstructCost — Gemini rates (gemini-3.1-pro)", () => {
  // Case G1 — usage_metadata; thoughts (700) are SEPARATE from candidates (1500),
  // both billed at the output rate -> output tokens 2200.
  // input 5000/1e6*2.0=0.010 + cacheRead 5000/1e6*0.20=0.001 + output 2200/1e6*12.0=0.0264 = 0.0374
  it("computes a Gemini call adding thoughts at the output rate", () => {
    const rawCall: RawCall = {
      raw_usage: {
        usage_metadata: {
          prompt_token_count: 10000,
          candidates_token_count: 1500,
          cached_content_token_count: 5000,
          thoughts_token_count: 700,
        },
      },
      call_flags: { provider: "gemini" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: geminiModel });
    const c = result.perCall[0];
    expect(c.provider).toBe("gemini");
    expect(c.components.inputCost).toBeCloseTo(0.01, 6);
    expect(c.components.cacheReadCost).toBeCloseTo(0.001, 6);
    expect(c.components.outputCost).toBeCloseTo(0.0264, 6);
    expect(c.components.reasoningTokens).toBe(700);
    expect(c.components.cacheWrite5mTokens).toBe(0);
    expect(c.components.batchMultiplier).toBe(1);
    expect(c.computedCost).toBeCloseTo(0.0374, 6);
  });

  // Case G2 — Gemini has NO batch discount: is_batch true -> multiplier stays 1, warns.
  it("does NOT apply a batch discount for Gemini (is_batch true -> stays 1, warns)", () => {
    const rawCall: RawCall = {
      raw_usage: {
        usage_metadata: {
          prompt_token_count: 10000,
          candidates_token_count: 1500,
          cached_content_token_count: 5000,
          thoughts_token_count: 700,
        },
      },
      call_flags: { provider: "gemini", is_batch: true },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: geminiModel });
    const c = result.perCall[0];
    expect(c.components.batchMultiplier).toBe(1);
    expect(c.computedCost).toBeCloseTo(0.0374, 6);
    expect(c.warnings.some((w) => w.includes("batch"))).toBe(true);
  });
});

describe("reconstructCost — totals, error %, and the Phase 1 gate", () => {
  // Two identical cache calls, each 0.01815 → totalComputed 0.0363.
  const makeCacheCall = (): RawCall => ({
    raw_usage: {
      input_tokens: 2000,
      output_tokens: 400,
      cache_read_input_tokens: 8000,
      cache_creation_input_tokens: 1000,
    },
    call_flags: { provider: "anthropic" },
  });

  // 5a — exact billed: overallErrorPct 0, passes.
  it("reports overallErrorPct 0 and passes when billed is exact", () => {
    const r = reconstructCost({
      rawCalls: [makeCacheCall(), makeCacheCall()],
      model: sonnetModel,
      billedPerCall: [0.01815, 0.01815],
    });
    expect(r.totalComputed).toBeCloseTo(0.0363, 6);
    expect(r.totalBilled).toBeCloseTo(0.0363, 6);
    expect(r.overallErrorPct).toBeCloseTo(0, 6);
    expect(r.passesPhase1).toBe(true);
  });

  // 5b — billed [0.020, 0.020] (totalBilled 0.04 vs computed 0.0363).
  // CORRECT arithmetic: |0.0363 - 0.04| / 0.04 = 0.0037 / 0.04 = 0.0925 (9.25% > 5% → FAILS).
  // (The mission brief stated 0.00925/pass — that was an arithmetic slip; 0.0037/0.04 is 0.0925.
  //  We keep the brief's input numbers but assert the evidence-correct outcome.)
  it("fails the Phase 1 gate when billed is ~9% above computed", () => {
    const r = reconstructCost({
      rawCalls: [makeCacheCall(), makeCacheCall()],
      model: sonnetModel,
      billedPerCall: [0.02, 0.02],
    });
    expect(r.totalBilled).toBeCloseTo(0.04, 6);
    expect(r.overallErrorPct).toBeCloseTo(0.0925, 6);
    expect(r.passesPhase1).toBe(false);
  });

  // 5c — no billed at all: overallErrorPct null, passesPhase1 false (gate cannot be evaluated).
  it("reports null overallErrorPct and does not pass when no billed is known", () => {
    const r = reconstructCost({
      rawCalls: [makeCacheCall(), makeCacheCall()],
      model: sonnetModel,
      billedPerCall: [null, null],
    });
    expect(r.totalBilled).toBeNull();
    expect(r.overallErrorPct).toBeNull();
    expect(r.passesPhase1).toBe(false);
  });

  // 5d — genuine within-tolerance pass: billed [0.0185, 0.0185] (totalBilled 0.037).
  // |0.0363 - 0.037| / 0.037 = 0.0007 / 0.037 ≈ 0.0189 (1.89% < 5% → passes).
  it("passes the Phase 1 gate within tolerance (billed ~1.9% above computed)", () => {
    const r = reconstructCost({
      rawCalls: [makeCacheCall(), makeCacheCall()],
      model: sonnetModel,
      billedPerCall: [0.0185, 0.0185],
    });
    expect(r.totalBilled).toBeCloseTo(0.037, 6);
    expect(r.overallErrorPct).toBeCloseTo(0.01892, 4);
    expect(r.passesPhase1).toBe(true);
  });
});

describe("reconstructCost — provider detection and errors", () => {
  // Case 6 — unrecognized raw_usage shape -> UNKNOWN_PRICING. (OpenAI/Gemini shapes
  // are now RECONSTRUCTED; only a truly unknown shape throws. Detection is from the
  // raw_usage shape, so call_flags.provider is irrelevant here.)
  it("throws UNKNOWN_PRICING for an unrecognized raw_usage shape", () => {
    const rawCall: RawCall = {
      raw_usage: { foo: 1 },
      call_flags: { provider: "anthropic" }, // call_flags.provider is best-effort; detection is from raw_usage shape
    };
    let err: unknown = null;
    try {
      reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReconstructError);
    expect((err as ReconstructError).code).toBe("UNKNOWN_PRICING");
  });

  // Case 7 — missing raw_usage → throws NO_RAW_USAGE.
  it("throws NO_RAW_USAGE when raw_usage is missing", () => {
    const rawCall = { call_flags: { provider: "anthropic" } } as RawCall;
    let err: unknown = null;
    try {
      reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReconstructError);
    expect((err as ReconstructError).code).toBe("NO_RAW_USAGE");
  });
});

describe("reconstructCost — field-name defensiveness", () => {
  // OpenAI without prompt_tokens_details: cached_tokens is ABSENT (not 0).
  // computedCost = 1000/1e6*5 + 200/1e6*30 = 0.005 + 0.006 = 0.011 (all input
  // billed non-cached; no cache discount). A warning surfaces the absent
  // bill-changing field (runbook §4: field-name drift is suspect #1).
  it("warns when OpenAI prompt_tokens_details.cached_tokens is absent", () => {
    const rawCall: RawCall = {
      raw_usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
      },
      call_flags: { provider: "openai" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: gpt55Model });
    expect(result.perCall[0].computedCost).toBeCloseTo(0.011, 6);
    expect(
      result.warnings.some((w) => w.includes("cached_tokens absent")),
    ).toBe(true);
  });

  // OpenAI WITH prompt_tokens_details.cached_tokens: 0 — a legitimate no-cache
  // trace. Present-and-zero is NOT absent: no defensive warning fires.
  it("does NOT warn when OpenAI cached_tokens is present-and-zero (legitimate no-cache)", () => {
    const rawCall: RawCall = {
      raw_usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      call_flags: { provider: "openai" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: gpt55Model });
    expect(result.perCall[0].computedCost).toBeCloseTo(0.011, 6);
    expect(result.warnings.some((w) => w.includes("absent"))).toBe(false);
  });

  // Gemini without cached_content_token_count or thoughts_token_count: both
  // drift-prone fields ABSENT. Both warnings fire.
  it("warns when Gemini cached_content_token_count and thoughts_token_count are absent", () => {
    const rawCall: RawCall = {
      raw_usage: {
        usage_metadata: {
          prompt_token_count: 1000,
          candidates_token_count: 150,
        },
      },
      call_flags: { provider: "gemini" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: geminiModel });
    // cost = 1000/1e6*2 + 150/1e6*12 = 0.002 + 0.0018 = 0.0038 (thoughts 0).
    expect(result.perCall[0].computedCost).toBeCloseTo(0.0038, 6);
    expect(
      result.warnings.some((w) => w.includes("cached_content_token_count absent")),
    ).toBe(true);
    expect(
      result.warnings.some((w) => w.includes("thoughts_token_count absent")),
    ).toBe(true);
  });

  // Gemini with all fields present (existing fixture shape), values 0:
  // present-and-zero is NOT absent — no defensiveness warnings. Smoke check.
  it("does NOT warn for absent fields when Gemini usage_metadata is complete", () => {
    const rawCall: RawCall = {
      raw_usage: {
        usage_metadata: {
          prompt_token_count: 1000,
          candidates_token_count: 150,
          cached_content_token_count: 0,
          thoughts_token_count: 0,
        },
      },
      call_flags: { provider: "gemini" },
    };
    const result = reconstructCost({ rawCalls: [rawCall], model: geminiModel });
    expect(result.warnings.some((w) => w.includes("absent"))).toBe(false);
  });
});
