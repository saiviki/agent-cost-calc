import { describe, it, expect } from "vitest";
import {
  splitSourceId,
  labDisplayName,
  metadataToDisplayName,
  pickLabProviderCost,
  costToGenerated,
} from "../models-dev-mappers";
import type { Catalog } from "../models-dev-types";
import type { EditorialEntry } from "../model-catalog";

describe("models-dev-mappers", () => {
  describe("splitSourceId", () => {
    it("splits valid lab/model sourceId", () => {
      expect(splitSourceId("anthropic/claude-sonnet-5")).toEqual({
        lab: "anthropic",
        model: "claude-sonnet-5",
      });
    });

    it("handles empty sourceId gracefully", () => {
      expect(splitSourceId("")).toEqual({ lab: "", model: "" });
    });

    it("handles sourceId without slash", () => {
      expect(splitSourceId("no-slash-model")).toEqual({
        lab: "",
        model: "no-slash-model",
      });
    });
  });

  describe("labDisplayName", () => {
    it("maps known lab IDs to human display names", () => {
      expect(labDisplayName("anthropic")).toBe("Anthropic");
      expect(labDisplayName("openai")).toBe("OpenAI");
      expect(labDisplayName("xai")).toBe("xAI");
      expect(labDisplayName("zhipuai")).toBe("Z.ai");
    });

    it("passes through unknown lab IDs", () => {
      expect(labDisplayName("newlab")).toBe("newlab");
      expect(labDisplayName("")).toBe("");
    });
  });

  describe("metadataToDisplayName", () => {
    it("uses metadata.name when present", () => {
      const res = metadataToDisplayName(
        { id: "anthropic/claude-3-5", name: "Claude 3.5 Sonnet", description: "" },
        "anthropic/claude-3-5"
      );
      expect(res).toBe("Claude 3.5 Sonnet");
    });

    it("falls back to slug-derived title when metadata.name is missing", () => {
      const res = metadataToDisplayName(undefined, "anthropic/claude-sonnet-5");
      expect(res).toBe("Claude Sonnet 5");
    });
  });

  describe("pickLabProviderCost", () => {
    const fixtureCatalog: Catalog = {
      providers: {
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          env: [],
          npm: "",
          doc: "",
          models: {
            "claude-sonnet-5": {
              id: "claude-sonnet-5",
              name: "Claude Sonnet 5",
              description: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              release_date: "",
              last_updated: "",
              modalities: { input: ["text"], output: ["text"] },
              open_weights: false,
              limit: { context: 200000, output: 8192 },
              cost: { input: 3, output: 15, cache_read: 0.3 },
            },
          },
        },
        openrouter: {
          id: "openrouter",
          name: "OpenRouter",
          env: [],
          npm: "",
          doc: "",
          models: {
            "llama-3-70b": {
              id: "llama-3-70b",
              name: "Llama 3 70B",
              description: "",
              attachment: false,
              reasoning: false,
              tool_call: true,
              release_date: "",
              last_updated: "",
              modalities: { input: ["text"], output: ["text"] },
              open_weights: true,
              limit: { context: 128000, output: 4096 },
              cost: { input: 0.6, output: 0.6 },
            },
          },
        },
      },
      models: {},
    };

    it("picks cost from lab provider when available", () => {
      const res = pickLabProviderCost(fixtureCatalog, "anthropic/claude-sonnet-5");
      expect(res).not.toBeNull();
      expect(res?.providerUsed).toBe("anthropic");
      expect(res?.cost?.input).toBe(3);
      expect(res?.cost?.cache_read).toBe(0.3);
    });

    it("falls back to alphabetical provider search when lab provider lacks cost", () => {
      const res = pickLabProviderCost(fixtureCatalog, "meta/llama-3-70b");
      expect(res).not.toBeNull();
      expect(res?.providerUsed).toBe("openrouter");
      expect(res?.cost?.input).toBe(0.6);
    });

    it("returns null when model has no pricing anywhere", () => {
      const res = pickLabProviderCost(fixtureCatalog, "unknown/model-xyz");
      expect(res).toBeNull();
    });
  });

  describe("costToGenerated", () => {
    const mockEntry: EditorialEntry = {
      id: "claude-sonnet-5",
      sourceId: "anthropic/claude-sonnet-5",
      tier: "frontier",
      strengths: ["coding"],
      outputMultiplier: 1.0,
      multiplierSource: "test",
      multiplierConfidence: "high",
    };

    it("populates GeneratedPricing with cost and supportsCache=true when cache_read exists", () => {
      const res = costToGenerated(
        mockEntry,
        {
          id: "anthropic/claude-sonnet-5",
          name: "Claude Sonnet 5",
          description: "",
          open_weights: false,
          limit: { context: 200000 },
        },
        {
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
          providerUsed: "anthropic",
        }
      );

      expect(res.id).toBe("claude-sonnet-5");
      expect(res.sourceId).toBe("anthropic/claude-sonnet-5");
      expect(res.name).toBe("Claude Sonnet 5");
      expect(res.provider).toBe("Anthropic");
      expect(res.isOpen).toBe(false);
      expect(res.contextK).toBe(200);
      expect(res.inputPricePerM).toBe(3);
      expect(res.outputPricePerM).toBe(15);
      expect(res.cacheReadPricePerM).toBe(0.3);
      expect(res.cacheWritePricePerM).toBe(3.75);
      expect(res.supportsCache).toBe(true);
    });

    it("sets supportsCache=false when no cache pricing exists", () => {
      const res = costToGenerated(
        mockEntry,
        undefined,
        {
          cost: { input: 1, output: 2 },
          providerUsed: "openai",
        }
      );

      expect(res.supportsCache).toBe(false);
      expect(res.cacheReadPricePerM).toBeUndefined();
      expect(res.cacheWritePricePerM).toBeUndefined();
    });

    it("handles null costPicked gracefully", () => {
      const res = costToGenerated(mockEntry, undefined, null);
      expect(res.inputPricePerM).toBe(0);
      expect(res.outputPricePerM).toBe(0);
      expect(res.supportsCache).toBe(false);
    });
  });
});
