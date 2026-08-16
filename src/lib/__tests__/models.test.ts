import { describe, expect, it } from "vitest";
import { EDITORIAL_CATALOG } from "../../../scripts/model-catalog";
import { MODELS, calculateCost, filterModels } from "../models";

describe("curated lineup", () => {
  it("exposes only editorial models", () => {
    expect(MODELS.map((m) => m.id)).toEqual(EDITORIAL_CATALOG.map((e) => e.id));
    expect(MODELS).toHaveLength(16);
  });

  it("keeps stable local ids and provenance fields", () => {
    for (const model of MODELS) {
      expect(model.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/i);
      expect(model.modelDeveloper.length).toBeGreaterThan(0);
      expect(model.pricingProvider.length).toBeGreaterThan(0);
      expect(["live", "carried-forward"]).toContain(model.pricingStatus);
      expect(Number.isFinite(model.inputPricePerM)).toBe(true);
      expect(model.inputPricePerM).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not infer a silent default filter set", () => {
    const filtered = filterModels(MODELS, new Set(), new Set(), new Set());
    expect(filtered).toHaveLength(MODELS.length);
  });
});

describe("calculateCost", () => {
  it("prices a run against the selected model", () => {
    const sonnet = MODELS.find((m) => m.id === "claude-sonnet-4-6");
    expect(sonnet).toBeDefined();
    const cost = calculateCost(
      {
        modelId: "claude-sonnet-4-6",
        systemPromptTokens: 0,
        inputTokensPerRun: 1_000_000,
        outputTokensPerRun: 1_000_000,
        toolCallsPerRun: 0,
        tokensPerToolCall: 0,
        cacheHitRate: 0,
        runsPerDay: 1,
      },
      sonnet,
    );
    expect(cost.inputCost).toBe(sonnet!.inputPricePerM);
    expect(cost.outputCost).toBe(sonnet!.outputPricePerM);
    expect(cost.totalPerRun).toBeCloseTo(
      sonnet!.inputPricePerM + sonnet!.outputPricePerM,
    );
  });
});
