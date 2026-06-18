# SPEC — Trace Parser (`src/lib/parseTrace.ts`)

> Story S2 of `BUILD-PLAN-trace-counterfactual.md`.
> Target file: `src/lib/parseTrace.ts`
> Pure TypeScript, no DOM, no async, no imports beyond the types in `src/lib/models.ts`.

---

## 1. Canonical Input Formats

### 1.1 Anthropic Messages API — Response JSON

A single JSON object (or a JSON array of objects) returned by `POST /v1/messages`.

**Field names that matter — exact strings, no aliases:**

| Field path | Type | Meaning |
|---|---|---|
| `usage.input_tokens` | `number` | Non-cached input tokens billed at full input price |
| `usage.output_tokens` | `number` | Output (completion) tokens |
| `usage.cache_read_input_tokens` | `number` | Tokens served from the prompt cache (billed at cache-read price, ~0.1× input) |
| `usage.cache_creation_input_tokens` | `number` | Tokens written into the prompt cache this turn (billed at cache-write price, ~1.25× input) |
| `model` | `string` (optional) | Source model identifier, e.g. `"claude-sonnet-4-6-20251001"` |
| `content` | `array` (optional) | Array of content blocks — inspected for `tool_use` type to count tool calls |

All four `usage.*` fields are present on every successful Anthropic Messages API response.
`cache_read_input_tokens` and `cache_creation_input_tokens` are both `0` when prompt caching is not engaged.
`input_tokens` is always the **uncached** portion — i.e., the denominator arithmetic is:

```
totalInputTokensPerTurn = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

**Detection heuristic (see §7 for the authoritative algorithm):** a whole-string `JSON.parse` of the trimmed input **succeeds** → this format. The presence or absence of a `.usage` key is NOT part of detection — it is checked during the parse step (see §7).

### 1.2 Claude Code Session `.jsonl`

A file produced by the Claude Code CLI at `~/.claude/projects/<project-hash>/<session-id>.jsonl`.

Structure: **one JSON object per line**. Lines are conversation turns of varying types:

```jsonc
// A human/user turn — SKIP for token counting
{"type":"human","message":{"role":"user","content":"..."}}

// An assistant turn — PROCESS
{"type":"assistant","message":{"role":"assistant","content":[...],"usage":{"input_tokens":1200,"output_tokens":340,"cache_read_input_tokens":800,"cache_creation_input_tokens":0}}}

// A result/summary turn — SKIP
{"type":"result","subtype":"success","usage":{"input_tokens":...}}
```

**Rules for `.jsonl` parsing:**

1. Split raw string on `\n`. Ignore blank lines.
2. Attempt `JSON.parse` on each line independently. Lines that fail `JSON.parse` → add to `warnings`, continue.
3. Keep only lines where `parsed.type === "assistant"` AND `parsed.message?.usage?.input_tokens !== undefined`.
4. `type === "result"` lines MUST be skipped — they are session-level aggregates, not individual model calls.
5. Each qualifying assistant line = one "run" (one model API call).
6. Token fields to extract from each line's `message.usage`: same four fields as §1.1 (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).
7. Tool-call counting: inspect `message.content` (array). Count items where `item.type === "tool_use"`.
8. Source model: if any assistant line contains `message.model`, use the first non-null value found.

**Detection heuristic (see §7 for the authoritative algorithm):** if a whole-string `JSON.parse` of the trimmed input **fails**, the input is treated as `.jsonl` and processed line-by-line. A `.jsonl` file is multiple objects on separate lines, so it **always** fails a whole-string parse — this is expected, NOT an error. `JSON_PARSE_FAILED` is thrown only if the line-by-line pass also finds **zero** valid JSON lines (see §7 step 3).

---

## 2. Output Type

```typescript
export type ParsedRun = {
  sourceModel?: string;            // best-effort from trace; undefined if not found
  runs: number;                    // # of model API calls observed
  avgInputTokens: number;          // avg input_tokens across runs (non-cached)
  avgOutputTokens: number;         // avg output_tokens across runs
  avgCacheReadTokens: number;      // avg cache_read_input_tokens across runs
  avgCacheCreationTokens: number;  // avg cache_creation_input_tokens across runs
  measuredCacheHitRate: number;    // see §3
  toolCallsPerRun: number;         // avg tool_use blocks per run; 0 if none found
  warnings: string[];              // non-fatal issues; empty array if clean parse
};
```

**Rounding rule (precise):** the four **token** fields — `avgInputTokens`, `avgOutputTokens`, `avgCacheReadTokens`, `avgCacheCreationTokens` — are arithmetic means across `runs`, rounded with `Math.round` (Anthropic returns integer token counts). **`toolCallsPerRun` is NOT a token count — it is a rate** (mean `tool_use` blocks per run) and is kept as an **unrounded float** (e.g. 1 tool call across 2 runs → `0.5`). `measuredCacheHitRate` is likewise an unrounded float in `[0, 1]`. Do NOT apply `Math.round` to `toolCallsPerRun` or `measuredCacheHitRate`.

---

## 3. `measuredCacheHitRate` Formula

```
measuredCacheHitRate =
  totalCacheReadTokens
  ────────────────────────────────────────────────────────────
  totalCacheReadTokens + totalInputTokens + totalCacheCreationTokens
```

Where `total*` = sum across **all** runs (not avg), so the ratio is computed over the full token pool before averaging.

Edge cases:
- Denominator = 0 → `measuredCacheHitRate = 0` (no tokens observed at all).
- All tokens are cache reads (denominator = totalCacheReadTokens only) → `measuredCacheHitRate = 1.0`.
- Result is clamped to `[0, 1]`.

This matches the economic reality: cache_read saves on input price; input and cache_creation are both billed (at different rates). The rate reflects what fraction of total input tokens was served from cache.

---

## 4. `parsedRunToConfig` Mapping

```typescript
export function parsedRunToConfig(p: ParsedRun): AgentConfig
```

Maps `ParsedRun` to the existing `AgentConfig` shape in `src/lib/models.ts`:

| `AgentConfig` field | Source | Notes |
|---|---|---|
| `modelId` | Match `p.sourceModel` against `MODELS[].id` using `includes()` or prefix match (Anthropic appends date suffixes like `-20251001`). If no match → default to `"claude-sonnet-4-6"`. | |
| `systemPromptTokens` | `p.avgCacheCreationTokens` | Cache-creation tokens = the part of input written to cache = likely the system prompt. Best available proxy. |
| `inputTokensPerRun` | `p.avgInputTokens` | Non-cached user/context input per run. |
| `outputTokensPerRun` | `p.avgOutputTokens` | |
| `toolCallsPerRun` | `p.toolCallsPerRun` | |
| `tokensPerToolCall` | `200` | No reliable signal in the trace; use a fixed default. Add to `warnings` if `toolCallsPerRun > 0`. |
| `cacheHitRate` | `p.measuredCacheHitRate` | |
| `runsPerDay` | `p.runs` | For Anthropic JSON (single object or array), treat the count as a session. For `.jsonl`, the count of assistant turns is the run count. **Operator must override this slider** — add `"runsPerDay set to run count from trace; adjust to your actual daily volume"` to warnings. |

---

## 5. Typed Error

```typescript
export class TraceParseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "EMPTY_INPUT"
      | "NO_USAGE_FIELDS"
      | "JSON_PARSE_FAILED"
      | "NO_ASSISTANT_TURNS"
  ) {
    super(message);
    this.name = "TraceParseError";
  }
}
```

Throw conditions:

| Code | Condition |
|---|---|
| `EMPTY_INPUT` | `raw.trim() === ""` — checked before any other logic |
| `JSON_PARSE_FAILED` | Whole-string `JSON.parse` fails AND zero newline-split lines parse as valid JSON (a genuinely malformed single value, e.g. `{bad`). A multi-object `.jsonl` does NOT hit this — its whole-string parse fails by design and it routes to line-by-line parsing. |
| `NO_USAGE_FIELDS` | Trimmed input starts with `{` or `[`, `JSON.parse` succeeds, but the resulting object (or every object in the array) lacks `usage.input_tokens` |
| `NO_ASSISTANT_TURNS` | Detected as `.jsonl` but zero lines pass the `type === "assistant" + message.usage` filter after parsing |

Partial parse (some lines failed, some succeeded) is NOT an error — add failed lines to `warnings` and return the successful portion.

---

## 6. Function Signatures

```typescript
// src/lib/parseTrace.ts

import type { AgentConfig } from "./models";
import { MODELS } from "./models";

export type ParsedRun = { ... };           // as §2
export class TraceParseError extends Error { ... }  // as §5

export function parseTrace(raw: string): ParsedRun
export function parsedRunToConfig(p: ParsedRun): AgentConfig
```

Both are pure synchronous functions. No side effects. No `console.*`. Errors via `throw`.

---

## 7. Internal Detection + Parse Routing (authoritative — TWO-PASS)

Detection keys on whether the **whole string** parses as one JSON value — NOT on the first character. A `.jsonl` file starts with `{` yet must route to the line-by-line path; keying on the first char (and throwing on a failed whole-string parse) is the bug this supersedes.

```
parseTrace(raw):

1. Trim raw. If empty → throw EMPTY_INPUT.

2. PASS 1 — attempt JSON.parse(trimmed) on the WHOLE string:
     SUCCEEDS → format = "anthropic-json"; go to the anthropic parse step below.
     FAILS    → fall through to step 3. Do NOT throw yet — a .jsonl file is
                multiple objects and ALWAYS fails a whole-string JSON.parse.

3. PASS 2 — .jsonl fallback: split on "\n", trim each, drop blank lines.
     Attempt JSON.parse on each non-blank line independently.
       line fails  → push warning ("Line N: JSON parse failed; skipped"), continue.
     If ZERO lines parsed successfully (nothing was valid JSON anywhere)
       → throw JSON_PARSE_FAILED  (the genuinely-malformed single value, e.g. "{bad").
     Otherwise format = "jsonl"; apply the §1.2 rules (keep type==="assistant"
       lines with message.usage.input_tokens). If that filter yields ZERO
       qualifying turns → throw NO_ASSISTANT_TURNS.
```

**Parsing step for `"anthropic-json"`:**
1. Normalize: array → each element is one run; plain object → wrap in a single-element array.
2. For each element: check `element.usage?.input_tokens !== undefined`. If **no element** passes → throw `NO_USAGE_FIELDS`.
3. Silently skip array elements that lack `usage.input_tokens`; add a warning per skipped element.

**Why detection does not gate on `.usage`:** detection classifies *shape* (single JSON value vs line-delimited stream). Semantic validation (are the required fields present?) is the parse step's job. This keeps both `NO_USAGE_FIELDS` (a whole-parse-succeeds object missing usage) and `NO_ASSISTANT_TURNS` (a parseable `.jsonl` with no assistant turns) reachable through distinct, correct paths.

---

## 8. Unit Test Cases

Framework: **vitest**. File: `src/lib/__tests__/parseTrace.test.ts`.

### Case 1 — Anthropic JSON, single object, no caching

```typescript
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
```

### Case 2 — Anthropic JSON, single object, with caching active

```typescript
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

  // measuredCacheHitRate = 800 / (800 + 200 + 0) = 0.8
  expect(result.measuredCacheHitRate).toBeCloseTo(0.8, 5);
  expect(result.avgCacheReadTokens).toBe(800);
  expect(result.avgInputTokens).toBe(200);
});
```

### Case 3 — Anthropic JSON, array of responses (batch / multi-turn)

```typescript
it("parses array of Anthropic responses and averages correctly", () => {
  const input = JSON.stringify([
    {
      model: "claude-sonnet-4-6-20251001",
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
      content: [{ type: "tool_use", id: "tu_1", name: "read_file", input: {} }],
    },
    {
      model: "claude-sonnet-4-6-20251001",
      usage: { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 700, cache_creation_input_tokens: 0 },
      content: [],
    },
  ]);

  const result = parseTrace(input);

  expect(result.runs).toBe(2);
  expect(result.avgInputTokens).toBe(Math.round((1000 + 900) / 2));    // 950
  expect(result.avgOutputTokens).toBe(Math.round((200 + 300) / 2));    // 250
  expect(result.avgCacheReadTokens).toBe(Math.round((500 + 700) / 2)); // 600
  expect(result.avgCacheCreationTokens).toBe(Math.round((100 + 0) / 2)); // 50

  // measuredCacheHitRate = (500+700) / (500+700 + 1000+900 + 100+0)
  //                       = 1200 / (1200 + 1900 + 100) = 1200/3200 = 0.375
  expect(result.measuredCacheHitRate).toBeCloseTo(0.375, 5);

  // tool_use in first response only → avg = 1/2 = 0.5
  expect(result.toolCallsPerRun).toBe(0.5);
});
```

### Case 4 — Claude Code `.jsonl`, multiple assistant turns, one malformed line

```typescript
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
        usage: { input_tokens: 1500, output_tokens: 300, cache_read_input_tokens: 600, cache_creation_input_tokens: 0 },
      },
    }),
    "this is not json at all {{{",
    JSON.stringify({
      type: "result",
      subtype: "success",
      usage: { input_tokens: 999999, output_tokens: 999999, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [],
        usage: { input_tokens: 1200, output_tokens: 200, cache_read_input_tokens: 800, cache_creation_input_tokens: 50 },
      },
    }),
  ];
  const input = lines.join("\n");

  const result = parseTrace(input);

  // Only the two assistant turns count (result turn is skipped)
  expect(result.runs).toBe(2);
  expect(result.avgInputTokens).toBe(Math.round((1500 + 1200) / 2));    // 1350
  expect(result.avgOutputTokens).toBe(Math.round((300 + 200) / 2));     // 250
  expect(result.avgCacheReadTokens).toBe(Math.round((600 + 800) / 2));  // 700
  expect(result.avgCacheCreationTokens).toBe(Math.round((0 + 50) / 2)); // 25

  // measuredCacheHitRate = (600+800) / (600+800 + 1500+1200 + 0+50)
  //                       = 1400 / (1400 + 2700 + 50) = 1400/4150 ≈ 0.33735
  expect(result.measuredCacheHitRate).toBeCloseTo(1400 / 4150, 5);

  // tool_use: turn 1 has 2, turn 2 has 0 → avg = 1.0
  expect(result.toolCallsPerRun).toBe(1);

  // sourceModel from first assistant turn
  expect(result.sourceModel).toBe("claude-sonnet-4-6");

  // Malformed line produces a warning; result turn skip does NOT produce a warning
  expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  expect(result.warnings.some(w => w.includes("JSON"))).toBe(true);
});
```

### Case 5 — Empty input → throws `EMPTY_INPUT`

```typescript
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
```

### Case 6 — `NO_USAGE_FIELDS` when JSON parses but usage is absent

```typescript
it("throws TraceParseError NO_USAGE_FIELDS when JSON object has no usage.input_tokens", () => {
  // This input starts with "{" → detectFormat returns "anthropic-json".
  // JSON.parse succeeds. The parse step then checks for usage.input_tokens
  // and finds it absent → throws NO_USAGE_FIELDS.
  const input = JSON.stringify({ role: "assistant", content: "hello" });

  expect(() => parseTrace(input)).toThrow(TraceParseError);

  try {
    parseTrace(input);
  } catch (e) {
    expect((e as TraceParseError).code).toBe("NO_USAGE_FIELDS");
  }
});
```

### Case 7 — `parsedRunToConfig` model-ID fuzzy match

```typescript
it("parsedRunToConfig maps Anthropic date-suffixed model ID to known MODELS[] entry", () => {
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
  expect(config.systemPromptTokens).toBe(100);  // avgCacheCreationTokens
  expect(config.cacheHitRate).toBeCloseTo(0.4, 5);
  expect(config.toolCallsPerRun).toBe(2);
  expect(config.runsPerDay).toBe(5);
});
```

### Case 8 — `.jsonl` with zero assistant turns → throws `NO_ASSISTANT_TURNS`

```typescript
it("throws TraceParseError NO_ASSISTANT_TURNS when jsonl has no qualifying assistant turns", () => {
  const lines = [
    JSON.stringify({ type: "human", message: { role: "user", content: "hi" } }),
    JSON.stringify({ type: "result", subtype: "success", usage: { input_tokens: 100, output_tokens: 50 } }),
  ];
  const input = lines.join("\n");

  expect(() => parseTrace(input)).toThrow(TraceParseError);

  try {
    parseTrace(input);
  } catch (e) {
    expect((e as TraceParseError).code).toBe("NO_ASSISTANT_TURNS");
  }
});
```

---

## 9. Edge Cases — Explicit Handling Table

| Input condition | Required behavior |
|---|---|
| `cache_read_input_tokens` key missing from `usage` | Treat as `0`. Do not throw. Add to `warnings`: `"cache_read_input_tokens missing on turn N; assumed 0"`. |
| `cache_creation_input_tokens` key missing from `usage` | Same as above with field name. |
| `content` array absent or not an array | `toolCallsPerRun = 0` for that turn. No warning needed. |
| `model` field absent on all turns | `sourceModel = undefined`. No warning needed. |
| Single-element array `[{usage:...}]` | Treated as one run, not zero. |
| `usage.input_tokens` is `null` or non-number | Skip the turn. Add `"Turn N: input_tokens is not a number; skipped"` to warnings. |
| All lines fail `JSON.parse` (zero valid JSON anywhere) | Throw `JSON_PARSE_FAILED` (per §7 step 3 — nothing parsed at all). `NO_ASSISTANT_TURNS` is reserved for the case where lines DO parse but none qualify as assistant turns. |
| Negative token values | Treat as `0`. Add to `warnings`: `"Turn N: negative token count clamped to 0"`. |
| `measuredCacheHitRate` denominator = 0 | Return `0`. Never divide by zero. |
| `parsedRunToConfig` with unknown `sourceModel` | Default `modelId` to `"claude-sonnet-4-6"`. **Append** `"sourceModel <X> not found in MODELS; defaulted to claude-sonnet-4-6"` to `p.warnings` (in-place mutation of the passed array — that is the only warning channel, since `parsedRunToConfig` returns `AgentConfig` and has no separate warnings return). |

---

## 10. What This Spec Does NOT Cover

- S3 `counterfactual.ts` — separate concern.
- S4 UI panel — separate concern.
- S5 accuracy fixtures — separate concern (synthetic + real fixture TODO described in BUILD-PLAN).
- Non-Anthropic trace formats (OpenAI, Gemini) — explicitly out of scope per BUILD-PLAN §"Out of scope".
- Async / streaming / Server-Sent Events — pure sync parsing only.
- Browser `File` API parsing — caller is responsible for reading the file into a `string` before calling `parseTrace`.
