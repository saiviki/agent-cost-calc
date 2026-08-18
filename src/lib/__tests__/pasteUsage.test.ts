import { describe, expect, it } from "vitest";
import {
  MAX_PASTE_CHARS,
  MAX_TOKEN_VALUE,
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
    expect(config).not.toHaveProperty("runsPerDay");
  });

  it("defaults model when model_id is omitted", () => {
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

  it("rejects cached tokens that exceed input tokens", () => {
    expect(() =>
      usageToConfig({
        spans: [{ input_tokens: 100, output_tokens: 10, cached_tokens: 150 }],
      }),
    ).toThrow(/cached_tokens cannot exceed input_tokens/);
  });

  it("rejects unknown model ids instead of substituting the default", () => {
    expect(() =>
      usageToConfig({
        model_id: "not-a-real-model",
        spans: [{ input_tokens: 10, output_tokens: 5 }],
      }),
    ).toThrow(/Unknown model_id "not-a-real-model"/);
  });
});

describe("parseUsagePaste JSON", () => {
  it("parses object with spans", () => {
    const config = parseUsagePaste(`{
      "model_id": "claude-sonnet-4-6",
      "spans": [
        { "input_tokens": 1000, "output_tokens": 200, "cached_tokens": 400 }
      ]
    }`);
    expect(config.inputTokensPerRun).toBe(1000);
    expect(config.outputTokensPerRun).toBe(200);
    expect(config.cacheHitRate).toBeCloseTo(0.4);
    expect(config.modelId).toBe("claude-sonnet-4-6");
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
    expect(() => parseUsagePaste("{nope")).toThrow(/Invalid JSON/);
  });

  it("throws on empty input", () => {
    expect(() => parseUsagePaste("  ")).toThrow(/Input is empty/);
  });

  it("throws on oversized input before parsing", () => {
    const huge = `{${"x".repeat(MAX_PASTE_CHARS)}}`;
    expect(() => parseUsagePaste(huge)).toThrow(/too large/);
  });

  it("rejects negative, non-finite, and missing numeric values", () => {
    expect(() =>
      parseUsagePaste(
        `{"spans":[{"input_tokens":-1,"output_tokens":1}]}`,
      ),
    ).toThrow(/non-negative finite number/);
    expect(() =>
      parseUsagePaste(
        `{"spans":[{"input_tokens":null,"output_tokens":1}]}`,
      ),
    ).toThrow(/non-negative finite number/);
    expect(() =>
      parseUsagePaste(`{"spans":[{"output_tokens":1}]}`),
    ).toThrow(/requires input_tokens and output_tokens/);
  });

  it("rejects very large numeric values", () => {
    expect(() =>
      parseUsagePaste(
        `{"spans":[{"input_tokens":${MAX_TOKEN_VALUE + 1},"output_tokens":1}]}`,
      ),
    ).toThrow(/at most/);
  });

  it("rejects unknown model_id", () => {
    expect(() =>
      parseUsagePaste(
        `{"model_id":"mystery","spans":[{"input_tokens":1,"output_tokens":1}]}`,
      ),
    ).toThrow(/Unknown model_id "mystery"/);
  });
});

describe("parseUsagePaste CSV", () => {
  it("parses unquoted header + rows", () => {
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
    expect(() => parseUsagePaste(`foo,bar\n1,2`)).toThrow(PasteUsageError);
  });

  it("rejects quoted CSV instead of silently misparsing it", () => {
    expect(() =>
      parseUsagePaste(
        `input_tokens,output_tokens,tool_name\n10,5,"retriever, v2"`,
      ),
    ).toThrow(/Quoted CSV fields are not supported/);
  });

  it("rejects malformed numeric CSV cells", () => {
    expect(() =>
      parseUsagePaste(`input_tokens,output_tokens\nnope,5`),
    ).toThrow(/non-negative finite number/);
  });
});
