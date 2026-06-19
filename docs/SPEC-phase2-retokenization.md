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

## 8. Cost layer + UI (increment a)

`projectRetokenized(rawCalls, models?)` (src/lib/retokenizedCost.ts) is the Phase 2 cost layer: it takes the captured `rawCalls` (Phase 1 ground truth) and, for each target model, re-tokenizes the captured output text (and, where captured, prompt text) under that model's tokenizer and prices it at list rates. It is a sibling of `projectCounterfactual`, not a replacement — Effective/Nominal use the heuristic `outputMultiplier`; Retokenized uses real tokenizer counts.

```ts
export type RetokenizedCostRow = {
  model: Model;
  runs: number;               // rawCalls.length
  totalCost: number;          // sum over captured calls, no cache/batch
  perRunCost: number;         // totalCost / runs
  targetOutputTokens: number;
  targetInputTokens: number | null;  // null when no call captured promptText
  method: "exact" | "approx"; // worst-case across calls
  isExact: boolean;
  notes: string[];            // honesty flags
};
```

### 8.1 Contract

- **Counts** come from `countTokens` (src/lib/tokenize.ts): exact via `gpt-tokenizer` (o200k_base for GPT-5/o-series, cl100k_base for the GPT-4 era) for OpenAI targets; a flagged char-ratio approximation for Anthropic Claude 4.x / Gemini (no official client-side tokenizer exists without a backend + API key).
- **Cost** = re-tokenized tokens × the target model's list `inputPricePerM` / `outputPricePerM`. **No cache, no batch** — the counterfactual default per deliverable §3.2 ('for the target, default to FULL list price').
- **`method`** is worst-case: if any call is approx, the row is approx. `notes` carries the per-row honesty flags (approx family; response-only trace with no promptText).
- **Does not read** the heuristic `outputMultiplier`. `countTokens` is the only cross-model mechanism — this is the load-bearing distinction from the Effective/Nominal paths.
- Result is sorted cheapest-first by `totalCost`.

### 8.2 Honesty framing (load-bearing)

This layer models the **tokenizer effect on the SAME captured output text**. It answers 'what would this exact text cost, priced at the target model's rates, under the target's tokenizer?' It does **not** model the target model **generating** different-length output (verbose/reasoning models emit more tokens per task) — that is **Phase 3 end-to-end replay** and is out of scope here. So for OpenAI targets the row is exact; for Anthropic/Gemini targets it is a flagged approximation that cannot support a billed-accuracy claim.

### 8.3 UI

`src/app/page.tsx` gains a third toggle, **Retokenized**, alongside Effective/Nominal (it is disabled with reduced opacity + a tooltip when no trace is pasted). When selected it renders a dedicated table — **Model | Target out tok | $/run | Method** — separate from the Effective/Nominal `Projection` table (different row shape; no monthly roll-up, no Δ% column). The Method cell shows **exact** (emerald) or **approx** (amber) with a tooltip carrying the row's notes; the anchor row (the trace's source model) is highlighted with the 'your run' badge. The caption beneath the table states the honesty framing verbatim.

### 8.4 What this does NOT close

- **Model verbosity** (a different model emitting more/fewer tokens) — that is Phase 3 replay.
- **Cache / batch** on the counterfactual — deliberately omitted (counterfactual default = full list price).
- **Billed ±5% accuracy** — still the Phase 1 invoice gate (`reconstructCost.ts` `passesPhase1`), `it.todo` until a real trace + invoice lands.
- **Anthropic/Gemini true accuracy** — would need the Count Tokens API + an API key backend (out of scope; zero-backend).

### 8.5 Definition of done for this increment

- `npx tsc --noEmit` exit 0.
- `npm run test` green: **59 passed + 2 todo** (prior 54 + 5 new `retokenizedCost` tests).
- `npm run build` exit 0.
- Strictly additive: Effective/Nominal paths and the existing `rows`/`projectCounterfactual` untouched.
- `src/lib/retokenizedCost.ts` contains zero references to `outputMultiplier`.
- Nothing committed — left uncommitted for review.

## 9. Extension point: a real Anthropic/Gemini tokenizer (future)

The single `countTokens(text, modelId, provider)` dispatch in `src/lib/tokenize.ts` is **the seam** for swapping the Anthropic/Gemini char-ratio approximation for a real tokenizer. Adding an API-backed family (e.g. Anthropic `/v1/messages/count_tokens`) is a **localized** change: declare a new `TokenizerFamily` (e.g. `"anthropic-api"`), add one `if (family === "anthropic-api") { ... }` branch in `countTokens` that returns `method: "exact"`, and every call site (`retokenize.ts`, `retokenizedCost.ts`, `replayHarness.ts`) picks it up automatically — no call-site edits.

This is **not built here** because it requires a backend + an API key (the Count Tokens endpoint is server-side), which breaks this app's zero-backend posture. It is an **opt-in product decision**, deferred until someone accepts that tradeoff. Until then Anthropic/Gemini targets stay on the flagged char-ratio approx (`method: "approx"`) — honest about the ± 20-30% band, never a fake "exact". Cross-link: `src/lib/tokenize.ts` (see the `EXTENSION POINT (P7)` comment above `countTokens`).
