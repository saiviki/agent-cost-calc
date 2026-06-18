// Phase 2 cost layer tests (docs/SPEC-phase2-retokenization.md §8).
// Completion token counts are EMPIRICALLY determined from gpt-tokenizer o200k_base
// via `node -e "const {encode}=require('gpt-tokenizer/encoding/o200k_base'); ..."`:
//   'hello world hello world hello world' -> 6  [V]
//   'refactor the auth module'             -> 5  [V]
//   'summarize the changes and list risks' -> 8  [V]
//   'done'                                 -> 1  [V]
//
// Pricing read from src/lib/models.ts [V]:
//   gpt-5.5           : inputPricePerM = 5.0,  outputPricePerM = 30.0
//   claude-sonnet-4-6 : inputPricePerM = 3.0,  outputPricePerM = 15.0
//   llama-3.3-70b     : inputPricePerM = 0.10, outputPricePerM = 0.32
// (NOTE: the mission brief cited gpt-5.5 outputPricePerM as "5.00" — that is the
// INPUT price. The real OUTPUT price is 30.0. These tests assert the real 30.0.)
import { describe, it, expect } from "vitest";
import { projectRetokenized } from "../retokenizedCost";
import { MODELS } from "../models";
import type { RawCall } from "../parseTrace";

const gpt55 = MODELS.find((m) => m.id === "gpt-5.5")!;
const sonnet46 = MODELS.find((m) => m.id === "claude-sonnet-4-6")!;

const REPEAT = "hello world hello world hello world"; // 35 chars; o200k = 6 tokens [V]

function makeCall(
  over: Partial<RawCall> & { raw_usage?: Record<string, unknown> } = {},
): RawCall {
  return {
    raw_usage: {
      input_tokens: 1000,
      output_tokens: 6,
      ...(over.raw_usage ?? {}),
    },
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

describe("projectRetokenized — OpenAI exact target", () => {
  it("re-tokenizes completionText with the real o200k tokenizer (method exact, no promptText)", () => {
    const call = makeCall(); // response-only: promptText === ""
    const [row] = projectRetokenized([call], [gpt55]);

    expect(row.runs).toBe(1);
    expect(row.method).toBe("exact");
    expect(row.isExact).toBe(true);
    expect(row.targetOutputTokens).toBe(6); // [V] o200k count
    expect(row.targetInputTokens).toBeNull(); // no promptText captured
    // No input cost (no promptText) → totalCost is output-only.
    // gpt-5.5 outputPricePerM = 30.0 [V].
    const expectedTotal = (6 / 1e6) * 30.0;
    expect(row.totalCost).toBeCloseTo(expectedTotal, 10);
    expect(row.perRunCost).toBeCloseTo(row.totalCost, 10); // single run
    // Exact target → no approx honesty flag; response-only → 'No prompt text' note.
    expect(row.notes.some((n) => n.includes("approx"))).toBe(false);
    expect(row.notes.some((n) => n.includes("No prompt text"))).toBe(true);
  });
});

describe("projectRetokenized — Anthropic approx target", () => {
  it("flags approx + honest note; uses char-ratio for completion count", () => {
    const call = makeCall();
    const [row] = projectRetokenized([call], [sonnet46]);

    expect(row.method).toBe("approx");
    expect(row.isExact).toBe(false);
    // 35 chars / 3.5 chars-per-tok = 10 exactly
    expect(row.targetOutputTokens).toBe(Math.ceil(35 / 3.5));
    expect(row.notes.some((n) => n.includes("official client-side"))).toBe(true);
  });
});

describe("projectRetokenized — input + output cost (promptText captured)", () => {
  it("sums re-tokenized prompt + completion across two calls and prices both sides", () => {
    const calls: RawCall[] = [
      makeCall({
        full_text_content: {
          promptText: "refactor the auth module", // o200k = 5 [V]
          completionText: "done", // o200k = 1 [V]
        },
      }),
      makeCall({
        full_text_content: {
          promptText: "summarize the changes and list risks", // o200k = 8 [V]
          completionText: "done", // o200k = 1 [V]
        },
      }),
    ];
    const [row] = projectRetokenized(calls, [gpt55]);

    expect(row.runs).toBe(2);
    // totalOutput = 1 + 1 = 2 ; totalInput = 5 + 8 = 13 (exact o200k)
    expect(row.targetOutputTokens).toBe(2);
    expect(row.targetInputTokens).toBe(13);
    // outputCost = (2/1e6)*30.0 ; inputCost = (13/1e6)*5.0
    const outputCost = (2 / 1e6) * 30.0;
    const inputCost = (13 / 1e6) * 5.0;
    expect(row.totalCost).toBeCloseTo(outputCost + inputCost, 10);
    expect(row.perRunCost).toBeCloseTo(row.totalCost / 2, 10);
  });
});

describe("projectRetokenized — guards + sort", () => {
  it("returns [] for empty rawCalls", () => {
    expect(projectRetokenized([], [gpt55])).toEqual([]);
  });

  it("sorts results cheapest-first by totalCost", () => {
    const llama = MODELS.find((m) => m.id === "llama-3.3-70b")!;
    const call = makeCall(); // REPEAT completionText
    const rows = projectRetokenized([call], [gpt55, sonnet46, llama]);

    expect(rows).toHaveLength(3);
    const costs = rows.map((r) => r.totalCost);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
    }
    // On 6 tokens of REPEAT: gpt-5.5 (30.0/M) ≈ 0.00018, sonnet-4-6 (15.0/M, 10
    // approx tokens) ≈ 0.00015, llama-3.3-70b (0.32/M, 9 approx tokens) ≈ tiny.
    expect(rows[0].model.id).toBe("llama-3.3-70b");
    expect(rows[2].model.id).toBe("gpt-5.5"); // 30.0/M output dominates
  });
});
