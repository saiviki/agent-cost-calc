// C6 — recommend() unit tests. From SPEC-recommend.md §8 (test fixtures table)
// + the algorithm in §4.2. Asserts:
//   (a) a cheap-but-incapable model is NOT recommended (capability floor enforced)
//   (b) anchor-already-optimal → recommended: null
//   (c) empty-capable-models guard → recommended: null, monthlySaving: 0 (no crash)
//   (d) saving math is correct and never negative
//
// Fixtures use the real MODELS catalog + CAPABILITY_FLOOR so the cost math is the
// live engine (projectCounterfactual → calculateCost), not hand-faked numbers.
import { describe, it, expect } from "vitest";
import { recommend, CAPABILITY_FLOOR } from "../recommend";
import { MODELS, type AgentConfig, type Model } from "../models";
import type { Classification, TaskType, Complexity } from "../classifyTask";
import type { ParsedRun } from "../parseTrace";
import { projectCounterfactual } from "../counterfactual";

// ── Shared fixtures ──

// Minimal ParsedRun — recommend() does not read p directly for the math (it uses
// config), so a bare object suffices. signals omitted (type-legal: signals?).
function makeParsedRun(): ParsedRun {
  return {
    sourceModel: "claude-opus-4-7",
    runs: 100,
    avgInputTokens: 5000,
    avgOutputTokens: 2000,
    avgCacheReadTokens: 0,
    avgCacheCreationTokens: 1000,
    measuredCacheHitRate: 0,
    toolCallsPerRun: 5,
    warnings: [],
  };
}

function makeConfig(modelId: string): AgentConfig {
  return {
    modelId,
    systemPromptTokens: 10_000,
    inputTokensPerRun: 5_000,
    outputTokensPerRun: 2_000,
    toolCallsPerRun: 5,
    tokensPerToolCall: 500,
    cacheHitRate: 0.6,
    runsPerDay: 500,
  };
}

function makeClassification(
  taskType: TaskType,
  complexity: Complexity,
  overrides: Partial<Classification> = {},
): Classification {
  return {
    taskType,
    complexity,
    taskTypeConfidence: 0.9,
    complexityConfidence: 0.9,
    evidence: [],
    ...overrides,
  };
}

const modelById = (id: string): Model => {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`test setup: model ${id} not in catalog`);
  return m;
};

describe("recommend — capability floor + saving math (SPEC-recommend §4.2/§8)", () => {
  // (a) floor enforcement — a cheap-but-incapable model is NOT recommended.
  // Haiku 4.5 (coding=50) is cheap but fails coding/med floor (coding≥68).
  it("never recommends a cheap-but-incapable model (Haiku blocked for coding/med)", () => {
    const p = makeParsedRun();
    const cls = makeClassification("coding", "med");
    // Anchor = expensive frontier so a cheaper switch is plausible.
    const config = makeConfig("claude-opus-4-7");

    const rec = recommend(p, cls, config);

    // Haiku 4.5 must NOT be the recommendation — it fails the coding/med floor.
    expect(rec.recommended?.id).not.toBe("claude-haiku-4-5");

    // Whatever IS recommended (or the anchor, if null) must clear the floor.
    const floor = CAPABILITY_FLOOR.coding.med;
    const chosen = rec.recommended ?? rec.current;
    expect(chosen.capability).toBeDefined();
    expect(chosen.capability!.scores.coding).toBeGreaterThanOrEqual(floor.coding);
    expect(chosen.capability!.scores.reasoning).toBeGreaterThanOrEqual(
      floor.reasoning,
    );
    expect(chosen.capability!.scores.general).toBeGreaterThanOrEqual(
      floor.general,
    );
  });

  // Cross-check: Haiku clears coding/med floor? It must not (proves the floor bites).
  it("confirms Haiku 4.5 fails the coding/med capability floor", () => {
    const haiku = modelById("claude-haiku-4-5");
    const floor = CAPABILITY_FLOOR.coding.med;
    expect(haiku.capability!.scores.coding).toBeLessThan(floor.coding);
  });

  // (b) anchor-already-optimal → recommended: null, monthlySaving: 0.
  // Two-pass: let recommend() itself name the cheapest-capable model for chat/low
  // (anchoring on an expensive frontier so it must point elsewhere), then re-anchor
  // ON that model — recommend() must now say "already optimal" (recommended: null).
  // This avoids re-deriving "cheapest" with logic that could drift from the engine.
  it("returns recommended: null when the anchor is already the cheapest capable model", () => {
    const p = makeParsedRun();
    const cls = makeClassification("chat", "low");

    // Pass 1 — expensive anchor → recommend points to the cheapest-capable model.
    const firstRec = recommend(p, cls, makeConfig("claude-opus-4-7"));
    expect(firstRec.recommended).not.toBeNull();
    const cheapestCapableId = firstRec.recommended!.id;

    // Pass 2 — anchor ON that cheapest-capable model → must be "already optimal".
    const rec = recommend(p, cls, makeConfig(cheapestCapableId));

    expect(rec.recommended).toBeNull();
    expect(rec.monthlySaving).toBe(0);
    expect(rec.current.id).toBe(cheapestCapableId);
    expect(rec.rationale).toContain("already the cheapest");
  });

  // (c) empty-capable-models guard → null, monthlySaving 0, NO crash.
  // Force the empty path by passing a classification cell whose floor no model
  // clears. We can't easily mutate the frozen CAPABILITY_FLOOR, so we drive the
  // empty branch via a real cell only if one exists; otherwise verify the guard
  // by constructing an unreachable floor through the public recommend() with a
  // classification that maps to research/high (the strictest cell) and asserting
  // no-crash + valid shape regardless of whether some frontier model clears it.
  it("does not crash and returns a valid Recommendation for the strictest floor cell", () => {
    const p = makeParsedRun();
    const cls = makeClassification("research", "high"); // reasoning≥78, general≥82
    const config = makeConfig("claude-opus-4-7");

    expect(() => recommend(p, cls, config)).not.toThrow();
    const rec = recommend(p, cls, config);

    // Shape invariants always hold.
    expect(rec.monthlySaving).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(rec.caveats)).toBe(true);
    expect(typeof rec.rationale).toBe("string");
  });

  // (c, explicit) empty-capable-models guard — drive it deterministically by
  // calling recommend with a config whose anchor is in-catalog but where we
  // simulate "no capable model" via monkeypatching capability off every model.
  // We restore afterwards. This exercises Step 5.5 directly (no crash, null, 0).
  it("returns recommended: null with monthlySaving 0 when NO model clears the floor", () => {
    const p = makeParsedRun();
    const cls = makeClassification("coding", "high");
    const config = makeConfig("claude-opus-4-7");

    // Strip capability from every model so capableModels is empty (Step 5.5).
    const saved = MODELS.map((m) => m.capability);
    try {
      for (const m of MODELS) delete (m as { capability?: unknown }).capability;

      expect(() => recommend(p, cls, config)).not.toThrow();
      const rec = recommend(p, cls, config);

      expect(rec.recommended).toBeNull();
      expect(rec.monthlySaving).toBe(0);
      expect(rec.current.id).toBe("claude-opus-4-7");
      expect(rec.rationale.toLowerCase()).toContain("no model");
    } finally {
      // Restore capability on every model.
      MODELS.forEach((m, i) => {
        if (saved[i] !== undefined) m.capability = saved[i];
      });
    }
  });

  // Restore-integrity sanity: after the strip/restore test, capability is back.
  it("restores model capability after the strip test", () => {
    expect(modelById("claude-opus-4-7").capability).toBeDefined();
    expect(modelById("claude-haiku-4-5").capability).toBeDefined();
  });

  // (d) saving math is correct and never negative — normal cheaper-switch path.
  it("computes a correct, non-negative monthlySaving on a real cheaper switch", () => {
    const p = makeParsedRun();
    const cls = makeClassification("chat", "low"); // budget models clear this
    const config = makeConfig("claude-opus-4-7"); // expensive anchor

    const rec = recommend(p, cls, config);

    // A cheaper capable model should exist for chat/low vs Opus.
    expect(rec.recommended).not.toBeNull();
    expect(rec.monthlySaving).toBeGreaterThan(0);

    // Saving must equal anchorMonthly − recommendedMonthly (rounded to 2dp), live.
    const projections = projectCounterfactual(config, MODELS);
    const anchorMonthly = projections.find((x) => x.isAnchor)!.breakdown
      .totalPerMonth;
    const recMonthly = projections.find(
      (x) => x.model.id === rec.recommended!.id,
    )!.breakdown.totalPerMonth;
    const expected = Math.round((anchorMonthly - recMonthly) * 100) / 100;
    expect(rec.monthlySaving).toBeCloseTo(expected, 2);
  });

  // (d, invariant) monthlySaving is NEVER negative across every taskType/complexity
  // cell for a representative anchor — exercises Steps 6.5/7/8 broadly.
  it("never returns a negative monthlySaving across all floor cells", () => {
    const p = makeParsedRun();
    const taskTypes: TaskType[] = [
      "coding",
      "extraction",
      "research",
      "agentic",
      "reasoning",
      "chat",
    ];
    const complexities: Complexity[] = ["low", "med", "high"];

    for (const anchorId of [
      "claude-opus-4-7",
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
    ]) {
      const config = makeConfig(anchorId);
      for (const t of taskTypes) {
        for (const c of complexities) {
          const rec = recommend(p, makeClassification(t, c), config);
          expect(rec.monthlySaving).toBeGreaterThanOrEqual(0);
          if (rec.recommended === null) {
            expect(rec.monthlySaving).toBe(0);
          }
        }
      }
    }
  });

  // Anchor-unknown edge (SPEC §4.3) — no crash, null, 0.
  it("returns recommended: null when the anchor model is not in the catalog", () => {
    const p = makeParsedRun();
    const cls = makeClassification("coding", "med");
    const config = makeConfig("unknown-model-xyz");

    const rec = recommend(p, cls, config);

    expect(rec.recommended).toBeNull();
    expect(rec.monthlySaving).toBe(0);
    expect(rec.rationale).toContain("not in the known model catalog");
  });

  // Caveats — low confidence surfaces an override prompt (SPEC §4.6).
  it("surfaces a low-confidence caveat with override prompt", () => {
    const p = makeParsedRun();
    const cls = makeClassification("chat", "low", {
      taskTypeConfidence: 0.3,
      complexityConfidence: 0.3,
    });
    const config = makeConfig("claude-opus-4-7");

    const rec = recommend(p, cls, config);

    expect(rec.caveats.length).toBeGreaterThanOrEqual(1);
    expect(
      rec.caveats.some((cv) => cv.toLowerCase().includes("override")),
    ).toBe(true);
  });
});
