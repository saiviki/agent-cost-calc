// Phase 2 re-tokenization engine tests (docs/SPEC-phase2-retokenization.md §5).
// Completion token counts are EMPIRICALLY determined from gpt-tokenizer o200k_base:
//   node -e "const {encode}=require('gpt-tokenizer'); console.log(encode('hello world hello world hello world').length)"
//   -> 6 ; encode('refactor the auth module') -> 5 ; encode('done') -> 1
import { describe, it, expect } from "vitest";
import { retokenizeRun } from "../retokenize";
import { MODELS } from "../models";
import type { RawCall } from "../parseTrace";

const gpt55 = MODELS.find((m) => m.id === "gpt-5.5")!;
const sonnet46 = MODELS.find((m) => m.id === "claude-sonnet-4-6")!;

const REPEAT = "hello world hello world hello world"; // 35 chars; o200k = 6 tokens [V]

function makeCall(over: Partial<RawCall> & { raw_usage?: Record<string, unknown> } = {}): RawCall {
  return {
    raw_usage: { input_tokens: 1000, output_tokens: 9, ...(over.raw_usage ?? {}) },
    full_text_content: {
      promptText: "",
      completionText: REPEAT,
      ...(over.full_text_content ?? {}),
    },
    call_flags: {
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      ...(over.call_flags ?? {}),
    },
    ...over,
  };
}

describe("retokenizeRun — OpenAI exact target", () => {
  it("re-tokenizes completionText with the real o200k tokenizer (method exact)", () => {
    const call = makeCall({ raw_usage: { input_tokens: 1000, output_tokens: 9 } });
    const res = retokenizeRun([call], gpt55);

    expect(res.method).toBe("exact");
    expect(res.perCall[0].targetCompletionTokens).toBe(6); // [V] o200k count
    expect(res.perCall[0].sourceCompletionTokens).toBe(9);
    expect(res.perCall[0].completionDiffPct).toBeCloseTo((6 - 9) / 9, 5);
  });
});

describe("retokenizeRun — Anthropic approx target", () => {
  it("flags approx + honest note; uses char-ratio for completion count", () => {
    const call = makeCall({ raw_usage: { input_tokens: 1000, output_tokens: 9 } });
    const res = retokenizeRun([call], sonnet46);

    expect(res.method).toBe("approx");
    expect(
      res.notes.some((n) => n.includes("official client-side tokenizer")),
    ).toBe(true);
    // 35 chars / 3.5 = 10 exactly
    expect(res.perCall[0].targetCompletionTokens).toBe(Math.ceil(35 / 3.5));
  });
});

describe("retokenizeRun — input-side (promptText)", () => {
  it("computes target prompt tokens + diff when promptText is captured", () => {
    const call = makeCall({
      raw_usage: { input_tokens: 1000, output_tokens: 5 },
      full_text_content: {
        promptText: "refactor the auth module", // o200k = 5 tokens [V]
        completionText: "done", // o200k = 1 token [V]
      },
    });
    const res = retokenizeRun([call], gpt55);

    expect(res.perCall[0].hasPromptText).toBe(true);
    expect(res.perCall[0].targetPromptTokens).not.toBeNull();
    expect(res.perCall[0].targetPromptTokens).toBe(5);
    expect(res.perCall[0].promptDiffPct).not.toBeNull();
  });

  it("returns null prompt fields + a 'No prompt text' note for response-only traces", () => {
    const call = makeCall({
      raw_usage: { input_tokens: 1000, output_tokens: 5 },
      full_text_content: { promptText: "", completionText: "done" },
    });
    const res = retokenizeRun([call], gpt55);

    expect(res.perCall[0].hasPromptText).toBe(false);
    expect(res.perCall[0].targetPromptTokens).toBeNull();
    expect(res.perCall[0].promptDiffPct).toBeNull();
    expect(res.notes.some((n) => n.includes("No prompt text"))).toBe(true);
  });
});
