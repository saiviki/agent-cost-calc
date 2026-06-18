// Phase 1 reconstruction harness tests. Implements docs/SPEC-phase1-reconstruction.md §4.
// All values are hand-computed and asserted to 6 decimal places. The test Model
// is hard-coded (Claude Sonnet 4.6 prices) so the suite is price-stable across
// MODELS edits (house style: SPEC-effective-cost.md §5).
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
  // Case 6 — OpenAI raw_usage shape → detected, throws UNSUPPORTED_PROVIDER (do not guess).
  it("throws UNSUPPORTED_PROVIDER for a non-Anthropic raw_usage shape", () => {
    const rawCall: RawCall = {
      raw_usage: { prompt_tokens: 100 },
      call_flags: { provider: "anthropic" }, // call_flags.provider is best-effort; detection is from raw_usage shape
    };
    let err: unknown = null;
    try {
      reconstructCost({ rawCalls: [rawCall], model: sonnetModel });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReconstructError);
    expect((err as ReconstructError).code).toBe("UNSUPPORTED_PROVIDER");
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
