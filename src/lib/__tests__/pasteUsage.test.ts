import { describe, expect, it } from "vitest";
import {
  parseUsagePaste,
  PasteUsageError,
  usageToConfig,
} from "../pasteUsage";

describe("usageToConfig", () => {
  it("sums span tokens and derives cache hit rate", () => {
    const config = usageToConfig({
      model_id: "claude-sonnet-4-6",
      spans: [
        {
          input_tokens: 4200,
          output_tokens: 890,
          cached_tokens: 1800,
          tool_name: "retriever",
        },
        { input_tokens: 800, output_tokens: 110, cached_tokens: 0 },
      ],
    });

    expect(config.systemPromptTokens).toBe(0);
    expect(config.inputTokensPerRun).toBe(5000);
    expect(config.outputTokensPerRun).toBe(1000);
    expect(config.toolCallsPerRun).toBe(1);
    expect(config.tokensPerToolCall).toBe(0);
    expect(config.cacheHitRate).toBeCloseTo(1800 / 5000);
    expect(config.modelId).toBe("claude-sonnet-4-6");
    expect(config.runsPerDay).toBe(100);
  });

  it("defaults model when missing", () => {
    const config = usageToConfig({
      spans: [{ input_tokens: 100, output_tokens: 50 }],
    });
    expect(config.modelId).toBe("claude-sonnet-4-6");
    expect(config.toolCallsPerRun).toBe(0);
    expect(config.cacheHitRate).toBe(0);
  });

  it("rejects empty spans", () => {
    expect(() => usageToConfig({ spans: [] })).toThrow(PasteUsageError);
  });
});

describe("parseUsagePaste JSON", () => {
  it("parses object with spans", () => {
    const config = parseUsagePaste(`{
      "model_id": "gpt-5-5",
      "spans": [
        { "input_tokens": 1000, "output_tokens": 200, "cached_tokens": 400 }
      ]
    }`);
    expect(config.inputTokensPerRun).toBe(1000);
    expect(config.outputTokensPerRun).toBe(200);
    expect(config.cacheHitRate).toBeCloseTo(0.4);
  });

  it("parses bare span array", () => {
    const config = parseUsagePaste(
      `[{"input_tokens": 10, "output_tokens": 5, "tool_name": "x"}]`,
    );
    expect(config.inputTokensPerRun).toBe(10);
    expect(config.toolCallsPerRun).toBe(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseUsagePaste("{nope")).toThrow(PasteUsageError);
  });

  it("throws on empty input", () => {
    expect(() => parseUsagePaste("  ")).toThrow(PasteUsageError);
  });
});

describe("parseUsagePaste CSV", () => {
  it("parses header + rows", () => {
    const config = parseUsagePaste(`input_tokens,output_tokens,cached_tokens,tool_name,model_id
4200,890,1800,retriever,claude-sonnet-4-6
800,110,0,,`);
    expect(config.inputTokensPerRun).toBe(5000);
    expect(config.outputTokensPerRun).toBe(1000);
    expect(config.toolCallsPerRun).toBe(1);
    expect(config.cacheHitRate).toBeCloseTo(1800 / 5000);
    expect(config.modelId).toBe("claude-sonnet-4-6");
  });

  it("requires input and output columns", () => {
    expect(() =>
      parseUsagePaste(`foo,bar\n1,2`),
    ).toThrow(PasteUsageError);
  });
});
