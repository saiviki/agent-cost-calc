import { describe, it, expect } from "vitest";
import {
  splitSourceId,
  labDisplayName,
  metadataToDisplayName,
  pickEditorialPrice,
  costToGenerated,
  markCarriedForward,
} from "../models-dev-mappers";
import type { Catalog, Model } from "../models-dev-types";
import type { EditorialEntry } from "../model-catalog";

function stubModel(id: string, cost?: Model["cost"]): Model {
  return {
    id,
    name: id,
    description: "",
    attachment: false,
    reasoning: false,
    tool_call: true,
    release_date: "",
    last_updated: "",
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context: 200000, output: 8192 },
    ...(cost ? { cost } : {}),
  };
}

const fixtureCatalog: Catalog = {
  providers: {
    aaa: {
      id: "aaa",
      name: "Aaa Host",
      env: [],
      npm: "",
      doc: "",
      models: {
        "llama-3-70b": stubModel("llama-3-70b", { input: 9.99, output: 9.99 }),
      },
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: [],
      npm: "",
      doc: "",
      models: {
        "claude-sonnet-5": stubModel("claude-sonnet-5", {
          input: 3,
          output: 15,
          cache_read: 0.3,
          cache_write: 3.75,
        }),
      },
    },
    together: {
      id: "together",
      name: "Together",
      env: [],
      npm: "",
      doc: "",
      models: {
        "llama-3-70b": stubModel("llama-3-70b", { input: 0.6, output: 0.6 }),
      },
    },
  },
  models: {
    "anthropic/claude-sonnet-5": {
      id: "anthropic/claude-sonnet-5",
      name: "Claude Sonnet 5",
      description: "",
      open_weights: false,
      limit: { context: 200000 },
    },
    "meta/llama-3-70b": {
      id: "meta/llama-3-70b",
      name: "Llama 3 70B",
      description: "",
      open_weights: true,
      limit: { context: 128000 },
    },
  },
};

const claudeEntry: EditorialEntry = {
  id: "claude-sonnet-5",
  sourceId: "anthropic/claude-sonnet-5",
  tier: "frontier",
  strengths: ["coding"],
  outputMultiplier: 1.0,
  multiplierSource: "test",
  multiplierConfidence: "high",
};

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
        "anthropic/claude-3-5",
      );
      expect(res).toBe("Claude 3.5 Sonnet");
    });

    it("falls back to slug-derived title when metadata.name is missing", () => {
      const res = metadataToDisplayName(undefined, "anthropic/claude-sonnet-5");
      expect(res).toBe("Claude Sonnet 5");
    });
  });

  describe("pickEditorialPrice", () => {
    it("uses the model developer's own listing when it has a price", () => {
      const res = pickEditorialPrice(fixtureCatalog, "anthropic/claude-sonnet-5");
      expect(res).not.toBeNull();
      expect(res?.pricingProvider).toBe("anthropic");
      expect(res?.cost.input).toBe(3);
      expect(res?.cost.cache_read).toBe(0.3);
    });

    it("uses a configured fallback provider when the lab has no price", () => {
      const res = pickEditorialPrice(
        fixtureCatalog,
        "meta/llama-3-70b",
        "together",
      );
      expect(res).not.toBeNull();
      expect(res?.pricingProvider).toBe("together");
      expect(res?.cost.input).toBe(0.6);
    });

    it("does not silently pick the first alphabetical host", () => {
      const res = pickEditorialPrice(fixtureCatalog, "meta/llama-3-70b");
      expect(res).toBeNull();
    });

    it("returns null when neither lab nor fallback has pricing", () => {
      const res = pickEditorialPrice(
        fixtureCatalog,
        "unknown/model-xyz",
        "together",
      );
      expect(res).toBeNull();
    });
  });

  describe("costToGenerated", () => {
    it("attributes developer vs pricing provider on direct lab pricing", () => {
      const res = costToGenerated(
        claudeEntry,
        fixtureCatalog.models["anthropic/claude-sonnet-5"],
        pickEditorialPrice(fixtureCatalog, claudeEntry.sourceId),
        { fetchedAt: "2026-08-16T00:00:00.000Z" },
      );

      expect(res.id).toBe("claude-sonnet-5");
      expect(res.sourceId).toBe("anthropic/claude-sonnet-5");
      expect(res.name).toBe("Claude Sonnet 5");
      expect(res.modelDeveloper).toBe("Anthropic");
      expect(res.pricingProvider).toBe("Anthropic");
      expect(res.pricingStatus).toBe("live");
      expect(res.inputPricePerM).toBe(3);
      expect(res.outputPricePerM).toBe(15);
      expect(res.cacheReadPricePerM).toBe(0.3);
      expect(res.supportsCache).toBe(true);
    });

    it("discloses a configured fallback host instead of the lab name", () => {
      const llamaEntry: EditorialEntry = {
        id: "llama-3-70b",
        sourceId: "meta/llama-3-70b",
        fallbackProvider: "together",
        tier: "budget",
        strengths: ["general"],
        outputMultiplier: 1,
        multiplierSource: "test",
        multiplierConfidence: "low",
      };
      const res = costToGenerated(
        llamaEntry,
        fixtureCatalog.models["meta/llama-3-70b"],
        pickEditorialPrice(fixtureCatalog, llamaEntry.sourceId, "together"),
      );

      expect(res.modelDeveloper).toBe("Meta");
      expect(res.pricingProvider).toBe("Together");
      expect(res.inputPricePerM).toBe(0.6);
      expect(res.pricingStatus).toBe("live");
    });

    it("sets supportsCache=false when no cache pricing exists", () => {
      const res = costToGenerated(claudeEntry, undefined, {
        cost: { input: 1, output: 2 },
        pricingProvider: "openai",
      });

      expect(res.supportsCache).toBe(false);
      expect(res.cacheReadPricePerM).toBeUndefined();
      expect(res.pricingProvider).toBe("OpenAI");
    });
  });

  describe("markCarriedForward", () => {
    it("normalizes a legacy snapshot row and marks it carried-forward", () => {
      const res = markCarriedForward(
        {
          id: "grok-4.1-fast",
          sourceId: "",
          name: "Grok 4.1 Fast",
          provider: "xAI",
          isOpen: false,
          contextK: 2000,
          inputPricePerM: 0.2,
          outputPricePerM: 0.5,
          cacheReadPricePerM: 0.05,
          supportsCache: true,
        },
        { id: "grok-4.1-fast", sourceId: "" },
      );
      expect(res.pricingStatus).toBe("carried-forward");
      expect(res.modelDeveloper).toBe("xAI");
      expect(res.pricingProvider).toBe("xAI");
      expect(res.inputPricePerM).toBe(0.2);
    });
  });
});
