# SPEC — Phase 1 Reconstruction (`src/lib/reconstructCost.ts` + additive `rawCalls` capture)

> Written: 2026-06-18
> Scope: Phase 1 reconstruction harness + additive raw capture (P0 items from `docs/AUDIT-counterfactual-vs-validation-spec.md` §5)
> Source: `docs/RESEARCH-validation-methodology.md` (methodology); `docs/AUDIT-counterfactual-vs-validation-spec.md` (gaps)
> Companion: `docs/SPEC-trace-parser.md`, `docs/SPEC-effective-cost.md`

---

## 1. Goal

Make **Phase 1** — re-derive billed cost from provider `raw_usage` as ground truth — buildable and tested, **additively**. No existing code path changes behaviour; the 28 existing parser tests + 2 `it.todo` stay green.

**Hard rule (verbatim, deliverable §3.3 / hard rule):**

> Cost is re-derived from provider `raw_usage` as GROUND TRUTH using exact provider rates. The heuristic `outputMultiplier` is NOT consulted. Reconstructed cost is compared against the actual invoice, not against the counterfactual estimate.

This module is that hard-rule foundation; `calculateCost` (the heuristic counterfactual) is untouched.

## 2. Additive RawCall capture

`parseTrace()` now populates `ParsedRun.rawCalls?: RawCall[]` for every qualifying run. It is optional, so hand-constructed `ParsedRun` literals (existing tests) remain type-legal. `parsedRunToConfig` and `calculateCost` do **not** read it.

```ts
export type CallFlags = {
  model?: string;
  provider: "anthropic" | "openai" | "gemini" | "unknown";
  is_batch?: boolean;          // Phase 1 correction #4 (batch = 50% off). Default false.
  hasMultimodal?: boolean;
  cacheTtlHint?: "5m" | "1h";  // best-effort from cache_control.ttl
};

export type RawCall = {
  raw_usage: Record<string, unknown>;            // ALWAYS populated (ground truth)
  raw_request?: unknown;                          // captured response element
  full_text_content?: { promptText: string; completionText: string };
  call_flags: CallFlags;
  request_id?: string;
};
```

**Honest limitations (documented in the type, not warned):**

- `raw_request` holds the captured **response** element, not the literal request — Anthropic responses do not echo request messages, so this is the reconstructible structured equivalent (deliverable §2).
- `full_text_content.promptText` is always `""` for the same reason: responses don't echo the prompt. This is a documented limitation, **not a parse problem**, and pushes **no warning** (Case 1's `warnings.length === 0` invariant is preserved). Phase 2 input-side re-tokenization is a follow-up.
- `is_batch` defaults `false`: responses do not reveal whether a request used the batch API. Correction #4 (batch = 50% off) hooks here once request metadata is available.
- `cacheTtlHint` is best-effort; response-side content rarely carries `cache_control`, so it is usually `undefined` (treated as the default 5m tier).

## 3. reconstructCost contract

`reconstructCost(input: ReconstructionInput): ReconstructionResult` maps each `RawCall` to a `ReconstructedCall` (per-call components + computed cost), then rolls up totals, an overall error %, and the Phase 1 pass/fail gate.

### 3.1 Anthropic rate table (exact)

| Component | Formula | Note |
|---|---|---|
| input | `tokens/1e6 × inputPricePerM` | base input rate |
| cache_read | `tokens/1e6 × cacheReadPricePerM` | **0.1× base** (Anthropic docs) |
| cache_write 5m | `tokens/1e6 × cacheWritePricePerM` | **1.25× base** (the 5m price the model stores) |
| cache_write 1h | `tokens/1e6 × (2 × inputPricePerM)` | **2× base input** (deliverable §3.2) |
| output | `tokens/1e6 × outputPricePerM` | base output rate |
| batch | `× 0.5` on the whole per-call total | correction #4; stacks on top |

Anthropic `usage` does not split `cache_creation_input_tokens` into 5m vs 1h. The split uses `call_flags.cacheTtlHint`; when that is `undefined` (the common case) all creation tokens are billed at the 5m tier.

### 3.2 Provider detection (do not guess)

`detectProvider(raw_usage)` keys off the usage shape: `input_tokens` → `anthropic`; `prompt_tokens` → `openai`; `usage_metadata`/`cached_content_token_count` → `gemini`; else `unknown`.

`reconstructCost` supports Anthropic, OpenAI, and Gemini (each priced at the model's real `cacheReadPricePerM`). An unrecognized usage shape throws `UNKNOWN_PRICING`. A missing `raw_usage` throws `NO_RAW_USAGE`.

### 3.3 Explicit non-use of outputMultiplier

`reconstructCost` never reads `model.outputMultiplier`. The model is passed in only as a price anchor. This is the deliverable's central point: reconstruction is ground-truth cost, not the heuristic counterfactual.

## 4. Test contracts

Hand-computed Sonnet 4.6 values (`inputPricePerM 3.00`, `outputPricePerM 15.00`, `cacheReadPricePerM 0.30`, `cacheWritePricePerM 3.75`):

- Single no-cache call (in 1000, out 250): **0.00675**
- Cache call, default 5m (in 2000, read 8000, create 1000, out 400): **0.01815**
- Same with `cacheTtlHint "1h"`: **0.0204** (write1h = 1000/1e6 × 6.00 = 0.006)
- Batch (5m case): **0.009075** (0.01815 × 0.5)
- `claude-code-session.jsonl` (2 runs): Run1 0.01815 + Run2 0.0192 = **0.03735**
- `droid-run.json` (GLM 5.1, 2 runs): Run1 0.008575 + Run2 0.009275 = **0.01785**
  (GLM 5.1 declares no `cacheWritePricePerM`, so its cache-creation tokens compute to 0 — we do not guess a missing price)

**The `it` split:**

- **Harness-math correctness** is now covered by **real** `it(...)` tests (`reconstructCost.test.ts` cases 1–7; `parseTrace.test.ts` fixture reconstruction). These verify the arithmetic and the raw-capture ↔ reconstruction round-trip. They need no real bill.
- **BILLED accuracy** (reconstructed total within ±5% of a real invoice) stays **`it.todo`**. It cannot be evaluated until an operator drops in real traces with actual billed cost. The Phase 1 *target* is <1–2%; the hard gate is ≤5%.

> Note: one sub-case asserts the gate can **reject**. With `billedPerCall [0.020, 0.020]` vs computed `0.0363`, the error is `0.0037/0.04 = 0.0925` (9.25%) → `passesPhase1 === false`. (An earlier draft listed 0.00925; `0.0037/0.04` is `0.0925`.)

## 5. What this does NOT close

This increment deliberately leaves open (linked to the AUDIT doc's P0–P3 list):

- **Cross-model input-side re-tokenization** (Phase 2) — needs a tokenizer dependency and a real `promptText` (today `""` because responses don't echo prompts).
- **OpenAI / Gemini ingestion** — detected but not reconstructed (no guessed cache rates).
- **Per-request cache preservation through `calculateCost`** — the counterfactual path still uses the measured hit-rate; this harness is a parallel ground-truth path.
- **Volume tiers / negotiated rates** — not modelled.
- **Real billed fixtures** — `fixtures/expected.json` `billedCostPerRun` stays `null`; `expectedReconstructedCost` is the deterministic reconstruction, not a real bill.

## 6. Definition of done for this increment

- [x] `npx tsc --noEmit` clean
- [x] `npm run test` green (existing 28 assertions pass + 2 `it.todo` + all new tests pass)
- [x] `npm run build` succeeds
- [x] Additive only — no existing path's behaviour changed
- [x] Nothing committed (build-plan constraint)

## 8. OpenAI + Gemini support (increment c1)

`computeCallCost(raw_usage, model, callFlags?)` is the shared single-call cost
reconstructor used by both Phase 1 (`reconstructCost`) and Phase 3 (the replay
harness default `actualCostFn`). It detects the provider from the `raw_usage`
shape and prices **every** provider at the model's **REAL** `cacheReadPricePerM`
— no guessed cache multiplier (deliverable §3.4).

- **OpenAI** — `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`
  / `completion_tokens_details.reasoning_tokens`. `completion_tokens` **already
  includes** reasoning tokens, so reasoning is surfaced for transparency but
  **NOT** added to cost (no double-count). Non-cached input = `prompt_tokens −
  cached_tokens`. OpenAI **Batch is 50% off** (`batchMultiplier = 0.5` when
  `is_batch`). Cache write is N/A (no cache-creation field) → 0.
- **Gemini** — counts under `usage_metadata`: `prompt_token_count`,
  `candidates_token_count`, `cached_content_token_count`, `thoughts_token_count`.
  `thoughts_token_count` is **separate** from candidates and billed at the
  **output** rate — they are **added**. Gemini has **NO 50% batch discount**
  (`batchMultiplier = 1` always; `is_batch` only emits a warning).
- **Anthropic** — unchanged; the `computeCallCost` anthropic branch mirrors
  `reconstructAnthropicCall` exactly (bit-identical numbers; it is NOT delegated,
  to guarantee the existing Anthropic reconstruction is untouched).
- **Unknown shape** → throws `ReconstructError` code `UNKNOWN_PRICING`.

Phase 3 `replayHarness.evaluateReplay` default `actualCostFn` now delegates to
`computeCallCost` (de-dup vs the prior inlined `anthropicActualCost`, which was
removed). A pluggable `actualCostFn` still overrides per-pair.
The prior non-Anthropic-provider throw is gone — all providers resolve by default.

**Definition of done for c1:** `tsc`/`test`/`build` green; existing Anthropic
reconstruction numbers unchanged; `parseTrace` ingestion of OpenAI/Gemini traces
is deferred to increment c2 (this rep touches `reconstructCost` +
`replayHarness` only). Honest caveat: a billed total within ±5% still requires a
real invoice to compare against.
