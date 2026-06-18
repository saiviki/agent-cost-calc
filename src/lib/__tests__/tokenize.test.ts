// Phase 2 tokenizer dispatch tests (docs/SPEC-phase2-retokenization.md §3).
// Token counts are EMPIRICALLY determined from the installed gpt-tokenizer
// (o200k_base) via `node -e` — never guessed. Evidence captured 2026-06-18:
//   node -e "const {encode}=require('gpt-tokenizer'); console.log(encode('hello world').length)"
//   -> 2   (o200k_base)
import { describe, it, expect } from "vitest";
import {
  countTokens,
  isExactForModel,
  tokenizerFamilyForModel,
} from "../tokenize";

describe("tokenize — countTokens", () => {
  // [V] verified: encode('hello world') === 2 tokens on o200k_base (gpt-tokenizer 3.4.0).
  it("returns exact o200k count for a GPT-5.x target", () => {
    const r = countTokens("hello world", "gpt-5.5", "OpenAI");
    expect(r.method).toBe("exact");
    expect(r.family).toBe("openai-o200k");
    expect(r.count).toBe(2);
    expect(r.source).toContain("o200k_base");
  });

  // [V] verified: encode('The quick brown fox jumps over the lazy dog.') === 10 tokens
  // on cl100k_base (gpt-tokenizer 3.4.0) via `gpt-tokenizer/encoding/cl100k_base`.
  // This exercises the cl100k ENCODE path (gpt-4 -> openai-cl100k): the family
  // resolution mapping was already covered above, but the actual cl100k encode
  // path was never asserted. Empirically determined via `node -e` (P4).
  it("returns exact cl100k count for a GPT-4 target", () => {
    const r = countTokens("The quick brown fox jumps over the lazy dog.", "gpt-4", "OpenAI");
    expect(r.method).toBe("exact");
    expect(r.family).toBe("openai-cl100k");
    expect(r.count).toBe(10);
    expect(r.source).toContain("cl100k_base");
  });

  it("returns flagged approx for a Claude 4.x target (no official client-side tokenizer)", () => {
    // 'hello world'.length === 11 -> ceil(11/3.5) === 4
    const r = countTokens("hello world", "claude-sonnet-4-6", "Anthropic");
    expect(r.method).toBe("approx");
    expect(r.family).toBe("anthropic-approx");
    expect(r.count).toBe(4);
    expect(r.source).toContain("NO official");
  });

  it("returns flagged approx for a Gemini target", () => {
    // 'hello world'.length === 11 -> ceil(11/4.0) === 3
    const r = countTokens("hello world", "gemini-3.1-pro", "Google");
    expect(r.method).toBe("approx");
    expect(r.family).toBe("gemini-approx");
    expect(r.count).toBe(3);
    expect(r.source).toContain("NO official");
  });
});

describe("tokenize — family resolution", () => {
  it("maps model ids to the correct tokenizer family", () => {
    expect(tokenizerFamilyForModel("gpt-5.4-mini", "OpenAI")).toBe("openai-o200k");
    expect(tokenizerFamilyForModel("gpt-4", "OpenAI")).toBe("openai-cl100k");
    expect(tokenizerFamilyForModel("claude-opus-4-7", "Anthropic")).toBe(
      "anthropic-approx",
    );
    expect(tokenizerFamilyForModel("gemini-3-flash", "Google")).toBe(
      "gemini-approx",
    );
  });
});

describe("tokenize — isExactForModel", () => {
  it("is exact only for OpenAI families", () => {
    expect(isExactForModel("gpt-5.5", "OpenAI")).toBe(true);
    expect(isExactForModel("claude-sonnet-4-6", "Anthropic")).toBe(false);
  });
});
