import { describe, expect, it } from "vitest";
import { validatePricingSnapshot } from "../validate-pricing-snapshot";
import type { EditorialEntry } from "../model-catalog";
import type { GeneratedPricing } from "../models-dev-mappers";

const editorial: EditorialEntry[] = [
  {
    id: "claude-sonnet-4-6",
    sourceId: "anthropic/claude-sonnet-4-6",
    tier: "frontier",
    strengths: ["coding"],
    outputMultiplier: 1,
    multiplierSource: "test",
    multiplierConfidence: "high",
  },
  {
    id: "grok-4.1-fast",
    sourceId: "",
    tier: "mid",
    strengths: ["fast"],
    outputMultiplier: 1,
    multiplierSource: "test",
    multiplierConfidence: "low",
  },
];

const liveClaude: GeneratedPricing = {
  id: "claude-sonnet-4-6",
  sourceId: "anthropic/claude-sonnet-4-6",
  name: "Claude Sonnet 4.6",
  modelDeveloper: "Anthropic",
  pricingProvider: "Anthropic",
  pricingStatus: "live",
  isOpen: false,
  contextK: 200,
  inputPricePerM: 3,
  outputPricePerM: 15,
  supportsCache: true,
  cacheReadPricePerM: 0.3,
};

const carriedGrok: GeneratedPricing = {
  id: "grok-4.1-fast",
  sourceId: "",
  name: "Grok 4.1 Fast",
  modelDeveloper: "xAI",
  pricingProvider: "xAI",
  pricingStatus: "carried-forward",
  isOpen: false,
  contextK: 2000,
  inputPricePerM: 0.2,
  outputPricePerM: 0.5,
  supportsCache: true,
  cacheReadPricePerM: 0.05,
};

function snapshot(models: GeneratedPricing[]) {
  return {
    source: "models.dev /catalog.json",
    fetchedAt: "2026-08-16T00:00:00.000Z",
    sourceEndpoint: "https://models.dev/catalog.json",
    models,
  };
}

describe("validatePricingSnapshot", () => {
  it("accepts a curated snapshot with provenance and a carried-forward warning", () => {
    const issues = validatePricingSnapshot(
      snapshot([liveClaude, carriedGrok]),
      editorial,
    );
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(issues.some((i) => i.message.includes("grok-4.1-fast"))).toBe(true);
  });

  it("rejects a non-editorial extra model", () => {
    const extra: GeneratedPricing = {
      ...liveClaude,
      id: "random-model",
      sourceId: "other/random",
    };
    const issues = validatePricingSnapshot(
      snapshot([liveClaude, carriedGrok, extra]),
      editorial,
    );
    expect(issues.some((i) => i.message.includes("non-editorial"))).toBe(true);
  });

  it("rejects missing editorial coverage", () => {
    const issues = validatePricingSnapshot(snapshot([liveClaude]), editorial);
    expect(issues.some((i) => i.message.includes("grok-4.1-fast"))).toBe(true);
  });

  it("rejects negative or non-finite prices", () => {
    const bad = { ...liveClaude, inputPricePerM: -1 };
    const issues = validatePricingSnapshot(snapshot([bad, carriedGrok]), editorial);
    expect(issues.some((i) => i.message.includes("inputPricePerM"))).toBe(true);
  });

  it("rejects an unmapped model that is not marked carried-forward", () => {
    const liveGrok = { ...carriedGrok, pricingStatus: "live" as const };
    const issues = validatePricingSnapshot(
      snapshot([liveClaude, liveGrok]),
      editorial,
    );
    expect(
      issues.some((i) => i.message.includes("must be marked carried-forward")),
    ).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const issues = validatePricingSnapshot(
      snapshot([liveClaude, liveClaude, carriedGrok]),
      editorial,
    );
    expect(issues.some((i) => i.message.includes("Duplicate model id"))).toBe(
      true,
    );
  });
});
