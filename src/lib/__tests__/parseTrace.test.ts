// S5 — parseTrace unit tests. Cases mirror SPEC-trace-parser.md §8.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseTrace,
  parsedRunToConfig,
  TraceParseError,
  type ParsedRun,
} from "../parseTrace";
import { reconstructCost } from "../reconstructCost";
import { MODELS, type Model } from "../models";

describe("parseTrace — Anthropic JSON", () => {
  // Case 1
  it("parses single Anthropic API response with no cache tokens", () => {
    const input = JSON.stringify({
      model: "claude-sonnet-4-6-20251001",
      usage: {
        input_tokens: 1000,
        output_tokens: 250,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      content: [],
    });

    const result = parseTrace(input);

    expect(result.runs).toBe(1);
    expect(result.avgInputTokens).toBe(1000);
    expect(result.avgOutputTokens).toBe(250);
    expect(result.avgCacheReadTokens).toBe(0);
    expect(result.avgCacheCreationTokens).toBe(0);
    expect(result.measuredCacheHitRate).toBe(0);
    expect(result.toolCallsPerRun).toBe(0);
    expect(result.sourceModel).toBe("claude-sonnet-4-6-20251001");
    expect(result.warnings).toHaveLength(0);
  });

  // Case 2
  it("computes measuredCacheHitRate correctly for single response with cache", () => {
    const input = JSON.stringify({
      model: "claude-opus-4-7-20251001",
      usage: {
        input_tokens: 200,
        output_tokens: 400,
        cache_read_input_tokens: 800,
        cache_creation_input_tokens: 0,
      },
      content: [],
    });

    const result = parseTrace(input);

    // 800 / (800 + 200 + 0) = 0.8
    expect(result.measuredCacheHitRate).toBeCloseTo(0.8, 5);
    expect(result.avgCacheReadTokens).toBe(800);
    expect(result.avgInputTokens).toBe(200);
  });

  // Case 3
  it("parses array of Anthropic responses and averages correctly", () => {
    const input = JSON.stringify([
      {
        model: "claude-sonnet-4-6-20251001",
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 100,
        },
        content: [{ type: "tool_use", id: "tu_1", name: "read_file", input: {} }],
      },
      {
        model: "claude-sonnet-4-6-20251001",
        usage: {
          input_tokens: 900,
          output_tokens: 300,
          cache_read_input_tokens: 700,
          cache_creation_input_tokens: 0,
        },
        content: [],
      },
    ]);

    const result = parseTrace(input);

    expect(result.runs).toBe(2);
    expect(result.avgInputTokens).toBe(Math.round((1000 + 900) / 2)); // 950
    expect(result.avgOutputTokens).toBe(Math.round((200 + 300) / 2)); // 250
    expect(result.avgCacheReadTokens).toBe(Math.round((500 + 700) / 2)); // 600
    expect(result.avgCacheCreationTokens).toBe(Math.round((100 + 0) / 2)); // 50

    // (500+700) / (500+700 + 1000+900 + 100+0) = 1200/3200 = 0.375
    expect(result.measuredCacheHitRate).toBeCloseTo(0.375, 5);

    // 1 tool_use across 2 runs → 0.5
    expect(result.toolCallsPerRun).toBe(0.5);
  });
});

describe("parseTrace — Claude Code .jsonl", () => {
  // Case 4
  it("parses Claude Code .jsonl, skips result turns and malformed lines, warns", () => {
    const lines = [
      JSON.stringify({ type: "human", message: { role: "user", content: "hello" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "tool_use", id: "tu_1", name: "bash", input: {} },
            { type: "tool_use", id: "tu_2", name: "read", input: {} },
          ],
          usage: {
            input_tokens: 1500,
            output_tokens: 300,
            cache_read_input_tokens: 600,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      "this is not json at all {{{",
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: {
          input_tokens: 999999,
          output_tokens: 999999,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [],
          usage: {
            input_tokens: 1200,
            output_tokens: 200,
            cache_read_input_tokens: 800,
            cache_creation_input_tokens: 50,
          },
        },
      }),
    ];
    const input = lines.join("\n");

    const result = parseTrace(input);

    expect(result.runs).toBe(2);
    expect(result.avgInputTokens).toBe(Math.round((1500 + 1200) / 2)); // 1350
    expect(result.avgOutputTokens).toBe(Math.round((300 + 200) / 2)); // 250
    expect(result.avgCacheReadTokens).toBe(Math.round((600 + 800) / 2)); // 700
    expect(result.avgCacheCreationTokens).toBe(Math.round((0 + 50) / 2)); // 25

    // 1400 / (1400 + 2700 + 50) = 1400/4150
    expect(result.measuredCacheHitRate).toBeCloseTo(1400 / 4150, 5);

    // tool_use: 2 + 0 → avg 1.0
    expect(result.toolCallsPerRun).toBe(1);

    expect(result.sourceModel).toBe("claude-sonnet-4-6");

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("JSON"))).toBe(true);
  });
});

describe("parseTrace — error conditions", () => {
  // Case 5
  it("throws TraceParseError EMPTY_INPUT on empty string", () => {
    expect(() => parseTrace("")).toThrow(TraceParseError);
    expect(() => parseTrace("   \n  ")).toThrow(TraceParseError);

    try {
      parseTrace("");
    } catch (e) {
      expect(e).toBeInstanceOf(TraceParseError);
      expect((e as TraceParseError).code).toBe("EMPTY_INPUT");
    }
  });

  // Case 6
  it("throws NO_USAGE_FIELDS when JSON object has no usage.input_tokens", () => {
    const input = JSON.stringify({ role: "assistant", content: "hello" });

    expect(() => parseTrace(input)).toThrow(TraceParseError);

    try {
      parseTrace(input);
    } catch (e) {
      expect((e as TraceParseError).code).toBe("NO_USAGE_FIELDS");
    }
  });

  // Case 8
  it("throws NO_ASSISTANT_TURNS when jsonl has no qualifying assistant turns", () => {
    const lines = [
      JSON.stringify({ type: "human", message: { role: "user", content: "hi" } }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    ];
    const input = lines.join("\n");

    expect(() => parseTrace(input)).toThrow(TraceParseError);

    try {
      parseTrace(input);
    } catch (e) {
      expect((e as TraceParseError).code).toBe("NO_ASSISTANT_TURNS");
    }
  });

  it("throws JSON_PARSE_FAILED on a genuinely malformed single value", () => {
    try {
      parseTrace("{bad");
    } catch (e) {
      expect(e).toBeInstanceOf(TraceParseError);
      expect((e as TraceParseError).code).toBe("JSON_PARSE_FAILED");
    }
    expect(() => parseTrace("{bad")).toThrow(TraceParseError);
  });
});

describe("parsedRunToConfig", () => {
  // Case 7
  it("maps Anthropic date-suffixed model ID to known MODELS[] entry", () => {
    const p: ParsedRun = {
      sourceModel: "claude-sonnet-4-6-20251001",
      runs: 5,
      avgInputTokens: 1000,
      avgOutputTokens: 300,
      avgCacheReadTokens: 400,
      avgCacheCreationTokens: 100,
      measuredCacheHitRate: 0.4,
      toolCallsPerRun: 2,
      warnings: [],
    };

    const config = parsedRunToConfig(p);

    expect(config.modelId).toBe("claude-sonnet-4-6");
    expect(config.inputTokensPerRun).toBe(1000);
    expect(config.outputTokensPerRun).toBe(300);
    expect(config.systemPromptTokens).toBe(100); // avgCacheCreationTokens
    expect(config.cacheHitRate).toBeCloseTo(0.4, 5);
    expect(config.toolCallsPerRun).toBe(2);
    expect(config.runsPerDay).toBe(5);
    expect(config.tokensPerToolCall).toBe(200);
  });

  it("defaults to claude-sonnet-4-6 and warns when sourceModel is unknown", () => {
    const p: ParsedRun = {
      sourceModel: "some-unknown-model-xyz",
      runs: 1,
      avgInputTokens: 100,
      avgOutputTokens: 50,
      avgCacheReadTokens: 0,
      avgCacheCreationTokens: 0,
      measuredCacheHitRate: 0,
      toolCallsPerRun: 0,
      warnings: [],
    };

    const config = parsedRunToConfig(p);

    expect(config.modelId).toBe("claude-sonnet-4-6");
    expect(p.warnings.some((w) => w.includes("not found in MODELS"))).toBe(true);
  });
});

// Phase 1/2 ground-truth rawCalls capture. Additive: parseTrace() now populates
// ParsedRun.rawCalls for every qualifying run so reconstructCost.ts can re-derive
// billed cost from provider raw_usage. See docs/SPEC-phase1-reconstruction.md §2.
describe("rawCalls capture (Phase 1 ground truth)", () => {
  // Case A — Anthropic JSON array (existing Case 3 input shape).
  it("captures one RawCall per qualifying Anthropic JSON element", () => {
    const input = JSON.stringify([
      {
        model: "claude-sonnet-4-6-20251001",
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 100,
        },
        content: [{ type: "tool_use", id: "tu_1", name: "read_file", input: {} }],
      },
      {
        model: "claude-sonnet-4-6-20251001",
        usage: {
          input_tokens: 900,
          output_tokens: 300,
          cache_read_input_tokens: 700,
          cache_creation_input_tokens: 0,
        },
        content: [],
      },
    ]);

    const result = parseTrace(input);

    expect(result.rawCalls).toBeDefined();
    expect(result.rawCalls).toHaveLength(2);
    expect(result.rawCalls![0].raw_usage.input_tokens).toBe(1000);
    expect(result.rawCalls![0].call_flags.provider).toBe("anthropic");
    expect(result.rawCalls![0].call_flags.model).toBe("claude-sonnet-4-6-20251001");
    // No text blocks in this fixture → completionText is "".
    expect(result.rawCalls![0].full_text_content!.completionText).toBe("");
    expect(result.rawCalls![0].full_text_content!.promptText).toBe("");
  });

  // Case B — Claude Code .jsonl: assistant turn with a text block + tool_use.
  it("captures completionText from text blocks in .jsonl assistant turns", () => {
    const lines = [
      JSON.stringify({ type: "human", message: { role: "user", content: "hi" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [
            { type: "text", text: "hello world" },
            { type: "tool_use", id: "tu_1", name: "bash", input: {} },
          ],
          usage: {
            input_tokens: 500,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ];
    const input = lines.join("\n");

    const result = parseTrace(input);

    expect(result.rawCalls).toHaveLength(1);
    expect(result.rawCalls![0].full_text_content!.completionText).toBe("hello world");
    expect(result.rawCalls![0].call_flags.hasMultimodal).toBe(false);
    expect(result.rawCalls![0].call_flags.provider).toBe("anthropic");
    expect(result.rawCalls![0].raw_usage.input_tokens).toBe(500);
  });

  // Phase 2 — prompt-text capture from .jsonl (docs/SPEC-phase2-retokenization.md §4).
  // ADDITIVE: existing assertions untouched.
  it("captures promptText from a preceding human text turn in .jsonl", () => {
    const lines = [
      JSON.stringify({
        type: "human",
        message: {
          role: "user",
          content: [{ type: "text", text: "Refactor the auth module" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "on it" }],
          usage: {
            input_tokens: 120,
            output_tokens: 12,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ];
    const input = lines.join("\n");

    const result = parseTrace(input);

    expect(result.rawCalls).toHaveLength(1);
    expect(result.rawCalls![0].full_text_content!.promptText).toContain(
      "Refactor the auth module",
    );
    // completionText is still captured from the assistant text block (unchanged).
    expect(result.rawCalls![0].full_text_content!.completionText).toBe("on it");
  });

  // Phase 2 regression guard: promptText must ACCUMULATE across turns (no reset).
  // Under the prior RESET bug, rawCalls[1].promptText would contain ONLY the
  // second user turn (a per-turn delta). Accumulate semantics -> turn 2 sees BOTH.
  it("accumulates promptText across multiple turns in .jsonl", () => {
    const lines = [
      JSON.stringify({
        type: "human",
        message: {
          role: "user",
          content: [{ type: "text", text: "FIRST user turn" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "reply one" }],
          usage: {
            input_tokens: 120,
            output_tokens: 12,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        type: "human",
        message: {
          role: "user",
          content: [{ type: "text", text: "SECOND user turn" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "reply two" }],
          usage: {
            input_tokens: 240,
            output_tokens: 24,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ];
    const input = lines.join("\n");

    const result = parseTrace(input);

    expect(result.rawCalls).toHaveLength(2);
    expect(result.rawCalls![0].full_text_content!.promptText).toContain(
      "FIRST user turn",
    );
    // Key regression assertion: turn 2 sees BOTH turns (accumulate), not just the delta.
    expect(result.rawCalls![1].full_text_content!.promptText).toContain(
      "FIRST user turn",
    );
    expect(result.rawCalls![1].full_text_content!.promptText).toContain(
      "SECOND user turn",
    );
  });
});

// Accuracy harness. Split into two tiers (docs/SPEC-phase1-reconstruction.md §4):
//   - Harness-math correctness: deterministic reconstruction from synthetic
//     raw_usage + dated prices — REAL tests now (no real bill needed).
//   - BILLED accuracy gate: ±5% vs a REAL operator invoice — stays it.todo until
//     an operator drops in real traces with actual billed cost.
describe("accuracy harness (real fixtures)", () => {
  // ── Harness-math correctness (REAL tests) ──
  it("reconstructs claude-code-session.jsonl to the hand-computed Sonnet total (0.03735)", () => {
    const raw = readFileSync(
      join(process.cwd(), "fixtures", "claude-code-session.jsonl"),
      "utf8",
    );
    const parsed = parseTrace(raw);
    // Sonnet 4.6 hand-computation (per-run):
    //   Run1: 2000×3/1e6=0.006 + 8000×0.30/1e6=0.0024 + 1000×3.75/1e6=0.00375 + 400×15/1e6=0.006 = 0.01815
    //   Run2: 2500×3/1e6=0.0075 + 9000×0.30/1e6=0.0027 + 0 + 600×15/1e6=0.009 = 0.0192
    //   totalComputed = 0.03735
    const sonnetModel: Model = {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "Anthropic",
      isOpen: false,
      tier: "mid",
      strengths: ["coding", "general"],
      contextK: 200,
      inputPricePerM: 3.0,
      outputPricePerM: 15.0,
      cacheReadPricePerM: 0.3,
      cacheWritePricePerM: 3.75,
      supportsCache: true,
      outputMultiplier: 1.0,
    };
    const result = reconstructCost({
      rawCalls: parsed.rawCalls ?? [],
      model: sonnetModel,
    });
    expect(result.totalComputed).toBeCloseTo(0.03735, 6);
  });

  it("reconstructs droid-run.json to the hand-computed GLM 5.1 total (0.01785)", () => {
    const raw = readFileSync(
      join(process.cwd(), "fixtures", "droid-run.json"),
      "utf8",
    );
    const parsed = parseTrace(raw);
    const glm = MODELS.find((m) => m.id === "glm-5.1")!;
    // GLM 5.1 prices (src/lib/models.ts:297-316): input 1.05, output 3.50,
    // cacheRead 0.525, supportsCache true, cacheWritePricePerM UNDEFINED.
    // Per harness rule cacheWrite5mCost = tokens/1e6 × (price ?? 0) = 0 — GLM 5.1
    // declares no write price, so we do NOT guess one (deliverable §3.4 'do not guess').
    //   Run1: 3000×1.05/1e6=0.00315 + 5000×0.525/1e6=0.002625 + 2000×0/1e6=0 + 800×3.50/1e6=0.0028 = 0.008575
    //   Run2: 3500×1.05/1e6=0.003675 + 6000×0.525/1e6=0.00315 + 0 + 700×3.50/1e6=0.00245 = 0.009275
    //   totalComputed = 0.01785
    const result = reconstructCost({
      rawCalls: parsed.rawCalls ?? [],
      model: glm,
    });
    expect(result.totalComputed).toBeCloseTo(0.01785, 6);
  });

  // ── BILLED accuracy gate (TODO — needs real operator invoices) ──
  it.todo(
    "BILLED accuracy gate (needs real invoice): claude-code-session within ±5%",
  );
  it.todo("BILLED accuracy gate (needs real invoice): droid-run within ±5%");
});

// C2 — OpenAI + Gemini ingestion in the single-JSON/array path (parseAnthropicJson).
// ADDITIVE: existing parseTrace tests remain unchanged. The .jsonl path stays
// Anthropic-only. raw_usage is preserved VERBATIM for reconstructCost; the
// normalized aggregate (avgInputTokens etc.) feeds the heuristic counterfactual
// only. See docs/SPEC-trace-parser.md §11.
describe("parseTrace — OpenAI + Gemini ingestion", () => {
  it("parses a single OpenAI Chat Completions response (prompt + cached + reasoning)", () => {
    const input = JSON.stringify({
      model: "gpt-5.5",
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 400 },
        completion_tokens_details: { reasoning_tokens: 50 },
      },
      choices: [{ message: { role: "assistant", content: "hi" } }],
    });

    const result = parseTrace(input);

    expect(result.runs).toBe(1);
    expect(result.sourceModel).toBe("gpt-5.5");
    // prompt_tokens (1000) - cached (400) = 600 non-cached input
    expect(result.avgInputTokens).toBe(600);
    expect(result.avgOutputTokens).toBe(200);
    expect(result.avgCacheReadTokens).toBe(400);
    expect(result.avgCacheCreationTokens).toBe(0);
    expect(result.rawCalls![0].call_flags.provider).toBe("openai");
    // raw_usage preserved verbatim (shallow copy of obj.usage)
    expect(result.rawCalls![0].raw_usage.prompt_tokens).toBe(1000);
    expect(
      (
        result.rawCalls![0].raw_usage.prompt_tokens_details as {
          cached_tokens: number;
        }
      ).cached_tokens,
    ).toBe(400);
    // clean-parse invariant: OpenAI responses push NO warnings
    expect(result.warnings).toHaveLength(0);
  });

  it("parses an array of OpenAI responses and averages the non-cached input", () => {
    const input = JSON.stringify([
      {
        model: "gpt-5.5",
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      },
      {
        model: "gpt-5.5",
        usage: {
          prompt_tokens: 800,
          completion_tokens: 100,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      },
    ]);

    const result = parseTrace(input);

    expect(result.runs).toBe(2);
    // (600 + 800) / 2 = 700
    expect(result.avgInputTokens).toBe(700);
    // (400 + 0) / 2 = 200
    expect(result.avgCacheReadTokens).toBe(200);
    expect(result.rawCalls).toHaveLength(2);
    expect(result.rawCalls![0].call_flags.provider).toBe("openai");
    expect(result.rawCalls![1].call_flags.provider).toBe("openai");
  });

  it("parses a single Gemini response (usage_metadata with cached + thoughts)", () => {
    const input = JSON.stringify({
      model_version: "gemini-3.1-pro",
      usage_metadata: {
        prompt_token_count: 1000,
        candidates_token_count: 150,
        cached_content_token_count: 300,
        thoughts_token_count: 50,
      },
    });

    const result = parseTrace(input);

    expect(result.runs).toBe(1);
    expect(result.sourceModel).toBe("gemini-3.1-pro");
    // prompt_token_count (1000) - cached (300) = 700 non-cached input
    expect(result.avgInputTokens).toBe(700);
    // candidates (150) + thoughts (50) = 200
    expect(result.avgOutputTokens).toBe(200);
    expect(result.avgCacheReadTokens).toBe(300);
    expect(result.avgCacheCreationTokens).toBe(0);
    expect(result.rawCalls![0].call_flags.provider).toBe("gemini");
    // raw_usage preserves the `usage_metadata` key verbatim (reconstructCost.detectProvider keys on it)
    expect(
      (
        result.rawCalls![0].raw_usage.usage_metadata as {
          candidates_token_count: number;
        }
      ).candidates_token_count,
    ).toBe(150);
    // clean-parse invariant
    expect(result.warnings).toHaveLength(0);
  });

  it("parses a flat Gemini response (prompt_token_count top-level, no usage_metadata) — P3 regression", () => {
    // Flat (non-standard) Gemini: counts live at the element top level, NOT
    // nested under usage_metadata. raw_usage MUST wrap them under a
    // usage_metadata key so reconstructCost.detectProvider recognizes gemini.
    const input = JSON.stringify({
      model_version: "gemini-3.1-pro",
      prompt_token_count: 1000,
      candidates_token_count: 150,
    });

    const result = parseTrace(input);

    expect(result.runs).toBe(1);
    expect(result.rawCalls![0].call_flags.provider).toBe("gemini");
    // The P3 guard: flat fields are wrapped under usage_metadata (not left flat).
    expect(
      (
        result.rawCalls![0].raw_usage.usage_metadata as {
          prompt_token_count: number;
        }
      ).prompt_token_count,
    ).toBe(1000);
    expect(
      (
        result.rawCalls![0].raw_usage.usage_metadata as {
          candidates_token_count: number;
        }
      ).candidates_token_count,
    ).toBe(150);
    // Full round-trip via reconstructCost must NOT throw (the P3 symptom).
    const model = MODELS.find((m) => m.id === "gemini-3.1-pro")!;
    const reconstructed = reconstructCost({
      rawCalls: result.rawCalls ?? [],
      model,
    });
    expect(reconstructed.totalComputed).toBeGreaterThan(0);
    // clean-parse invariant
    expect(result.warnings).toHaveLength(0);
  });

  it("ingests a mixed cross-provider array (Anthropic + OpenAI)", () => {
    const input = JSON.stringify([
      {
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 500, output_tokens: 100 },
      },
      {
        model: "gpt-5.5",
        usage: { prompt_tokens: 1000, completion_tokens: 200 },
      },
    ]);

    const result = parseTrace(input);

    expect(result.runs).toBe(2);
    expect(result.rawCalls![0].call_flags.provider).toBe("anthropic");
    expect(result.rawCalls![1].call_flags.provider).toBe("openai");
  });
});
