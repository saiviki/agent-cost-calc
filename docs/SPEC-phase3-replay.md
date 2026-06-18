# SPEC — Phase 3 End-to-End Replay Harness (`src/lib/replayHarness.ts`)

> Written: 2026-06-18
> Scope: Phase 3 end-to-end counterfactual replay **harness** (`docs/RESEARCH-validation-methodology.md` §4.4)
> Source: `docs/RESEARCH-validation-methodology.md` §4.4 (Phase 3 gate: ≥20 calls, median ≤5%, P95 ≤8–10%); §3.1 (re-tokenize captured text, no source counts)
> Companion: `docs/SPEC-phase2-retokenization.md` (re-tokenization layer this builds on), `docs/SPEC-phase1-reconstruction.md` (Anthropic actual-cost rates reused here)

---

## 1. Goal

Make **Phase 3** — the end-to-end counterfactual — buildable and tested, **additively**. This module ships the deterministic **HARNESS**: a replay-plan builder + an evaluator that consumes operator-supplied actual usages and emits per-pair counterfactual-vs-actual diffs, median/P95, and the acceptance gate. No existing code path changes behaviour; the 59 existing tests + 2 `it.todo` + `tsc` + `next build` stay green.

**HONESTY (load-bearing, P4):**

> This harness makes **ZERO live network calls**. The empirical Phase 3 result (median ≤5% / P95 ≤8–10% on ≥20 **real** model-B calls) is **NOT claimed here**. The gate becomes empirically meaningful only after an **operator** runs `buildReplayPlan` against real model B with their **own API key** (outside this zero-backend client) and feeds B's actual `raw_usage` back into `evaluateReplay`. We will not fake replay results or API calls. The harness is proven on **synthetic** operator-supplied actual-usage fixtures only.

## 2. `buildReplayPlan`

Adapts captured `rawCalls` into `ReplayItem`s the operator replays against model B. **No network.**

```ts
export type ReplayItem = {
  index: number;
  promptText: string;        // ftc?.promptText ?? ""
  completionText: string;    // ftc?.completionText ?? ""
  notes: string[];           // flags response-only calls
};
export type ReplayPlan = {
  targetModelId: string;
  targetProvider: string;
  items: ReplayItem[];
  warnings: string[];
};
export function buildReplayPlan(rawCalls: RawCall[], target: Model): ReplayPlan;
```

**Gaps surfaced as warnings/notes (honest, not hidden):**

- **Tool-schema gap (always warned).** The captured traces are Anthropic **responses**; responses do **not** echo the request's tool schemas. The replay therefore omits tools, so the counterfactual **undercounts** tool/system tokens. Residual per deliverable §3.3 ("a counterfactual that does not re-derive each term from captured ground-truth metadata will routinely drift"). Closing this needs `raw_request` ingestion (raw request messages + tool defs) — future work.
- **Response-only gap (per-item note + plan warning).** Calls with no captured `promptText` get the note `"no prompt text captured (response-only) - input-side replay unavailable for this call"`; if any such call exists, the plan warns `"input-side replay is partial"`.

## 3. `evaluateReplay`

Consumes operator-supplied **ACTUAL** B usages (one per plan item, call-order aligned) and computes per-pair counterfactual-vs-actual diffs, aggregate median/P95, and the gate.

```ts
export type ActualCall = { usage: Record<string, unknown>; billedCost?: number | null };
export type ActualCostFn = (usage: Record<string, unknown>, model: Model) => number;
export type ReplayPair = { ... inputTokenDiffPct: number | null; costDiffPct: number; method: TokenizerMethod; ... };
export type ReplayEvaluation = {
  pairs: ReplayPair[]; sampleSize: number;
  inputTokenDiffMedianPct: number | null; inputTokenDiffP95Pct: number | null;
  costDiffMedianPct: number; costDiffP95Pct: number;
  passesPhase3: boolean; gateBasis: "input" | "cost"; method: TokenizerMethod; warnings: string[];
};
export function evaluateReplay(plan, actuals, target, actualCostFn?) : ReplayEvaluation;
```

**Counterfactual side (`cost_B'`).** Re-tokenizes the captured text with B's tokenizer via `countTokens` (exact OpenAI o200k/cl100k, **approx** char-ratio Anthropic/Gemini — see SPEC-phase2 §2), priced at B's list rates, **no-cache default** (methodology §3.1). Never reads `model.outputMultiplier` — `countTokens` is the only cross-model bridge.

**Actual side (`cost_B`).** Uses `actualCostFn`. **Anthropic default** (`anthropicActualCost`, inlined locally — mirrors `reconstructCost`'s Anthropic math: input + cache_read + cache_creation + output, no batch, no 1h split since B's real usage does not echo the TTL). **OpenAI/Gemini actual-cost is deferred to increment (c)**, reached via the pluggable `actualCostFn` (P7). A non-Anthropic target + the default actualCostFn ⇒ `ReplayError(UNSUPPORTED_PROVIDER)` (same posture as `reconstructCost`).

**Usage field extraction is provider-shape-tolerant:** `actInput` reads `input_tokens` (Anthropic) else `prompt_tokens` (OpenAI) else 0; `actOutput` reads `output_tokens` else `completion_tokens` else 0.

**Errors:**

- `ReplayError(LENGTH_MISMATCH)` — `actuals.length !== plan.items.length`.
- `ReplayError(UNSUPPORTED_PROVIDER)` — non-Anthropic target with no `actualCostFn`.

## 4. Statistics + gate

**`median(values)`** — empty → 0; sort ascending; odd n → middle element `arr[floor(n/2)]`; even n → mean of the two middles `(arr[n/2-1] + arr[n/2]) / 2`. Does not mutate input.

**`p95(values)`** — empty → 0; sort ascending; **nearest-rank**: 1-indexed rank = `ceil(0.95*n)`, i.e. 0-indexed `min(n-1, ceil(0.95*n) - 1)`. Example: n=20 → rank 19 → 0-indexed 18 → the 19th value.

**Gate (methodology §4.4):** ACCEPT iff **median ≤ 5% AND P95 ≤ 8–10%** (we use the tight 10% bound).

- **`gateBasis = "input"`** when any pair has captured promptText (the cleanest signal — same prompt, B's real tokenization). Gate uses `inputTokenDiff*Pct`. This is the **primary** gate.
- **`gateBasis = "cost"`** when **no** promptText was captured. Gate uses `costDiff*Pct`. The methodology notes output-token variance is real ("isolate the input component if needed"); cost-side is **noisy** because B generates **different** completion text, so the warning says to interpret loosely.

**Warnings:** `sample size < 20` → "methodology 4.4 requires ≥20 calls; gate not statistically meaningful"; `gateBasis = "cost"` → the COST-diff-is-noisy warning; `method = "approx"` → the counterfactual side is a char-ratio estimate (input-side diff then reflects approx error, not pure tokenizer accuracy).

## 5. What this does NOT close

- **The empirical ±5% / P95 8–10% result.** Needs a live API key + a real replay of ≥20 calls per trace pair against model B. This module makes that **runnable**; it does not **run** it.
- **OpenAI/Gemini actual-cost (`cost_B`).** Anthropic-default today; the pluggable `actualCostFn` is the extension point for increment (c).
- **Tool/system token capture.** Needs `raw_request` ingestion (request messages + tool defs); replay omits tools today (§2).
- **Volume tiers / per-provider hidden fees** — opaque from a trace alone.

Cross-link: `docs/AUDIT-counterfactual-vs-validation-spec.md` item C3 ("Phase 3 — end-to-end counterfactual replay … ✗ MISSING") — this harness is the deterministic skeleton for C3; the empirical evidence still requires the operator replay.

## 6. How an operator runs it (the API-key step lives OUTSIDE this client)

1. `const plan = buildReplayPlan(rawCalls, targetModelB);`
2. For each `ReplayItem`, call model B with `item.promptText` as the user message (tools omitted — see §2), and capture B's raw `usage`.
3. Collect the results as `ActualCall[]` (call-order aligned with `plan.items`).
4. `const eval = evaluateReplay(plan, actuals, targetModelB /*, actualCostFn for non-Anthropic */);`
5. Check `eval.passesPhase3` + the `sample size` warning (need ≥20 for a meaningful gate).

Pseudocode (operator script, not part of this zero-backend app):

```ts
import { buildReplayPlan, evaluateReplay } from "./src/lib/replayHarness";
const plan = buildReplayPlan(rawCalls, targetB);           // pure, no network
const actuals = await runPlanAgainstModelB(plan, apiKey);  // OPERATOR step, needs key
const result = evaluateReplay(plan, actuals, targetB);     // pure, no network
```

`runPlanAgainstModelB` is **not** implemented here — it requires a backend + API key and breaks the zero-backend constraint, so it is an operator-owned script.

## 7. DoD

- `npx tsc --noEmit` → exit 0. [V]
- `npm run test` → prior 59 + 2 `it.todo` + 10 new all green (69 passed | 2 todo). [V]
- `npm run build` → exit 0. [V]
- Strictly additive: one new module + one new test file + one new SPEC. Nothing refactored (`reconstructCost` Anthropic math is inlined locally, not changed).
- Nothing committed; `git status` shows the new files unstaged.
- `replayHarness.ts` has **zero** `outputMultiplier` references (countTokens is the only cross-model bridge).
