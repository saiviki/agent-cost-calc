# SPEC — Phase 2 Cross-Model Re-tokenization (`src/lib/tokenize.ts` + `src/lib/retokenize.ts` + additive `parseTrace.ts` prompt capture)

> Written: 2026-06-18
> Scope: Phase 2 cross-model re-tokenization (`docs/RESEARCH-validation-methodology.md` §4.3)
> Source: `docs/RESEARCH-validation-methodology.md` §3.1 + §4.3; `docs/AUDIT-counterfactual-vs-validation-spec.md` (central finding = `outputMultiplier` is a heuristic, not a tokenizer)
> Companion: `docs/SPEC-phase1-reconstruction.md`

---

## 1. Goal

Make **Phase 2** — cross-model token counts come from **re-tokenizing captured text with the target model's tokenizer**, not from the heuristic `outputMultiplier` — buildable and tested, **additively**. No existing code path changes behaviour; the 42 existing tests + 2 `it.todo` + `tsc` + `next build` stay green.

**Hard rule (verbatim, deliverable §3.1 / correction #1):**

> Re-tokenize the captured `full_text_content` (prompt text **and** completion text) with the **target model's OFFICIAL tokenizer**. Use those counts × the target's list prices. **Never reuse the source model's token counts.**

This module is the token-count layer that replaces `outputMultiplier` as the cross-model bridge. `retokenize.ts` **never reads `model.outputMultiplier`**; cost (= counts × prices) remains a thin layer the UI / counterfactual applies on top.

## 2. The tokenizer-availability reality (load-bearing honesty)

A real client-side tokenizer exists for **only one** family. This is *why* ±5% cross-model is achievable to-exact for OpenAI targets but **not** for Anthropic/Gemini targets without adding a backend + API key.

| Family | Official client-side tokenizer? | Phase 2 method |
|---|---|---|
| **OpenAI — GPT-5.x / GPT-4o / o-series** | ✅ `gpt-tokenizer` **o200k_base** (pure JS, MIT, no WASM) | **exact** |
| **OpenAI — GPT-4 / GPT-3.5 era** | ✅ `gpt-tokenizer` **cl100k_base** | **exact** |
| **Anthropic — Claude 4.x** | ❌ No public client-side tokenizer. The Count Tokens API (`/v1/messages/count_tokens`) **requires an API key + a backend** — out of scope for this zero-backend app. | **approx** (char-ratio ~3.5 chars/tok, ±20-30% band) |
| **Google — Gemini** | ❌ No official client-side tokenizer (SentencePiece-based). | **approx** (char-ratio ~4.0 chars/tok, ±20-30% band) |

For Anthropic/Gemini we return `method: "approx"` with a **loud flag** in `source`/`notes`. The approximation is for **relative cross-model sizing**, **NOT a billed-accuracy claim**. We never impersonate an official tokenizer or label an approximation "exact".

The **only** new dependency is `gpt-tokenizer` (MIT, pure JS/TS, client-side, no WASM). We deliberately did **not** add `tiktoken` (WASM, heavier) or `@anthropic-ai/tokenizer` (deprecated/old-model — would fake current-Claude accuracy).

## 3. `tokenize.ts` contract

```ts
export type TokenizerMethod = "exact" | "approx";
export type TokenizerFamily =
  | "openai-o200k" | "openai-cl100k"
  | "anthropic-approx" | "gemini-approx" | "unknown";
export type TokenCount = { count: number; method: TokenizerMethod; family: TokenizerFamily; source: string };

export function tokenizerFamilyForModel(modelId: string, provider: string): TokenizerFamily;
export function countTokens(text: string, modelId: string, provider: string): TokenCount;
export function isExactForModel(modelId: string, provider: string): boolean;
```

**Family resolution** (provider is the `MODELS[]` display string):

1. id matches `^(gpt-5|gpt-4o|gpt-4-turbo|o1|o3|chatgpt)` → **openai-o200k** (id wins regardless of provider string).
2. provider OpenAI **and** id matches `^(gpt-4|gpt-3.5)` → **openai-cl100k**.
3. provider OpenAI (matched neither) → **openai-o200k** (current OpenAI default).
4. provider Anthropic / id contains `claude` → **anthropic-approx**.
5. provider Google/Gemini / id contains `gemini` → **gemini-approx**.
6. else **unknown**.

`isExactForModel` returns `true` iff the family starts with `openai` (i.e. a real client-side tokenizer exists). Encoding selection uses the package's documented per-encoding subpaths `gpt-tokenizer/encoding/o200k_base` and `gpt-tokenizer/encoding/cl100k_base` (the default `encode` is o200k_base; subpaths remove all ambiguity).

**Empirically verified counts (gpt-tokenizer 3.4.0, o200k_base):** `hello world` = 2; `The quick brown fox jumps over the lazy dog.` = 10; `hello world hello world hello world` = 6; `refactor the auth module` = 5; `done` = 1; empty = 0. Tests assert **these** values (determined via `node -e`, never guessed).

## 4. `parseTrace.ts` prompt-text capture (.jsonl only, additive)

`RawCall.full_text_content.promptText` was always `""` because Anthropic responses don't echo the request prompt. For **Claude Code `.jsonl` sessions** the user/system message text *is* in the file preceding each assistant turn, so we now capture it — unblocking input-side re-tokenization there.

- New pure helper `extractPromptTextFromContent(content)` mirrors the completion-side `extractTextFromContent`, with a **superset**: it also accepts a plain string (real Claude Code human turns often carry `content` as a string, not a block array). Pushes **no** warnings (the clean-parse invariant is preserved).
- Threaded into `parseJsonl` **only**: a rolling `promptTextBuffer` **accumulates** user/system text; at each qualifying assistant turn the buffer is snapshotted into that call's `promptText` **without resetting** — `promptText` = all user/system text seen BEFORE this turn. This is a **LOWER BOUND** on `raw_usage.input_tokens`: for a Messages API call `input_tokens` is the FULL conversation context (system prompt + all prior user + assistant + tool messages, minus cache-read), but `promptText` captures only the user-text portion — the system prompt, prior ASSISTANT turns, and `tool_result` blocks are NOT captured here (out of scope for this increment). So `targetPromptTokens` systematically UNDERCOUNTS relative to `input_tokens`; `promptDiffPct` is a conservative (negative-biased) proxy, not an equality. Accumulating (rather than resetting to a per-turn delta) restores monotonic growth of `promptDiffPct` with context size — the prior reset bug collapsed turn N's `promptText` to only the text since turn N−1, yielding a spurious negative `inputDiffPct` on every multi-turn trace (the primary Claude Code use case).
- `parseAnthropicJson` is **unchanged**: its `RawCall`s keep `promptText: ""` (responses don't echo the prompt). This is a **documented gap**: for response-only JSON traces, input-side Phase 2 is unavailable — only the output-side diff is computed.

`extractRawCall`'s signature is stable; the override happens at the `parseJsonl` call site after `extractRawCall` returns.

## 5. `retokenize.ts` contract

```ts
export function retokenizeRun(rawCalls: RawCall[], target: Model): RetokenizationResult;
```

Returns per-call + aggregate **source** vs **target** token counts and diff %:
- `sourceCompletionTokens` = `raw_usage.output_tokens` (ground truth from the original model). `sourcePromptTokens` = `raw_usage.input_tokens` (Anthropic) or `prompt_tokens` (OpenAI), `null` when absent.
- `targetCompletionTokens` / `targetPromptTokens` = re-tokenized captured text with the **target's** tokenizer.
- `completionDiffPct` / `promptDiffPct` = `(target − source)/source` (null when either side is missing — e.g. no promptText captured).
- Aggregate `method` = **worst-case** (`"approx"` if ANY call is approx, else `"exact"`). `outputDiffPct` is the primary cross-model signal; `inputDiffPct` is `null` when no call captured prompt text.
- `notes` carries the honesty flags: approx-family warning (when applicable), "No prompt text captured" (response-only traces), and "same-family comparison: within-family drift expected <5%".

This module **does not compute cost** (that stays in `reconstructCost` — Phase 1 ground truth — and `counterfactual` — heuristic) and **never reads `model.outputMultiplier`**.

## 6. What this does NOT close

- **Anthropic/Gemini true accuracy** — needs the Count Tokens API backend + API key (out of scope for this zero-backend app; flagged approx only). See `docs/AUDIT-counterfactual-vs-validation-spec.md`.
- **Billed ±5%** — still needs real invoices; that is the **Phase 1 gate** (`reconstructCost.ts` `passesPhase1`), not Phase 2.
- **Phase 3** end-to-end counterfactual replay (target pricing × Phase 2 counts).
- **Phase 4** edge coverage (multimodal, reasoning tokens, tool-JSON-schema residuals — `docs/RESEARCH-validation-methodology.md` §3.3 flags ~5-15% residual).

## 7. Definition of done for this increment

- `npx tsc --noEmit` exit 0.
- `npm run test` green: existing **42 passed + 2 todo** + all new `tokenize`/`retokenize`/`parseTrace` prompt-capture tests.
- `npm run build` exit 0.
- Strictly additive: no existing path's behaviour changed; `retokenize.ts` does not read `outputMultiplier`.
- `gpt-tokenizer` added to `package.json` dependencies (the only new dependency).
- Nothing committed — the Phase 2 diff is left uncommitted for review.
