# SPEC — Effective Cost: S1 + S3 Implementation Contract

> Written: 2026-05-30
> Gate-fix revision: 2026-05-30 (Haiku price correction, import fix, detectFormat consistency)
> Covers: S1 (outputMultiplier → calculateCost) and S3 (counterfactual engine)
> Source truth: BUILD-PLAN-trace-counterfactual.md (requirements), RESEARCH-consumption-multipliers.md (data), src/lib/models.ts (existing types)

---

## 1. Model type extension (S1)

### 1.1 New fields on `Model`

Add to the existing `Model` type in `src/lib/models.ts`:

```ts
outputMultiplier: number;
// Effective output-tokens-per-task relative to Claude Sonnet 4.6 non-reasoning (baseline = 1.0).
// Reasoning/verbose models > 1.0; terse models < 1.0.
// Computed from: Artificial Analysis Intelligence Index raw token counts.
// Formula: model_raw_tokens / claude_sonnet_4_6_nonreasoning_tokens (14M).

multiplierSource?: string;
// Human-readable citation. Example: "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30"

multiplierConfidence?: "high" | "med" | "low";
// high  = directly measured from Artificial Analysis token counts
// med   = measured but variant ambiguity exists (e.g., Qwen reasoning/non-thinking mixed)
// low   = no reasoning-mode data; placeholder used (GLM-5.1 is the only current case)
```

### 1.2 Values to apply to `MODELS[]`

Sourced from `RESEARCH-consumption-multipliers.md` rounded-values table. Use exactly these values — do not re-derive.

| Model ID | `outputMultiplier` | `multiplierConfidence` | Notes |
|---|---|---|---|
| `claude-opus-4-7` | 7.9 | `"high"` | Adaptive reasoning, max; 110M / 14M |
| `claude-sonnet-4-6` | 1.0 | `"high"` | Baseline |
| `gpt-5.5` | 5.4 | `"high"` | xhigh reasoning only; lower efforts unmeasured |
| `gemini-3.1-pro` | 4.1 | `"high"` | Reasoning preview; 57M / 14M |
| `deepseek-v4-pro` | 13.6 | `"high"` | Reasoning max; 190M / 14M |
| `kimi-k2.6` | 12.1 | `"high"` | Always-on reasoning; 170M / 14M |
| `claude-haiku-4-5` | 0.59 | `"high"` | Non-reasoning; 8.3M / 14M |
| `gpt-5.4-mini` | 0.17 | `"high"` | Non-reasoning default; 2.4M / 14M |
| `gemini-3-flash` | 5.1 | `"high"` | Reasoning default; 72M / 14M |
| `grok-4.1-fast` | 0.31 | `"high"` | Non-reasoning fast; 4.4M / 14M |
| `qwen-3.6-plus` | 7.1 | `"med"` | Reasoning default; variant mixing on AA |
| `glm-5.1` | 1.0 | `"low"` | Placeholder — no reasoning-mode AA data; see GLM note |
| `deepseek-v4-flash` | 17.1 | `"high"` | Reasoning max; 240M / 14M |
| `llama-3.3-70b` | 0.27 | `"med"` | Non-reasoning; 3.8M / 14M |
| `minimax-m2.7` | 6.2 | `"high"` | Reasoning default; 87M / 14M |
| `mistral-large-2` | 0.19 | `"high"` | Non-reasoning; 2.6M / 14M |

**GLM-5.1 note**: The reasoning variant has no Intelligence Index token count on Artificial Analysis (confirmed by direct page fetch 2026-05-30). Non-reasoning floor is 5.43x (76M) but is not used because `models.ts` deploys GLM-5.1 as a reasoning model. Placeholder `1.0` + `"low"` is the only defensible value from current public data. Surface a UI warning badge (see §4).

### 1.3 `multiplierSource` string convention

Use `"Artificial Analysis Intelligence Index v4.0 — <model-variant> — confirmed 2026-05-30"` for all high/med entries. GLM-5.1 uses `"placeholder: no reasoning-mode data on Artificial Analysis (2026-05-30)"`.

---

## 2. `calculateCost` extension (S1)

### 2.1 Signature change

```ts
// Before (preserved behavior):
export function calculateCost(config: AgentConfig): CostBreakdown

// After:
export function calculateCost(
  config: AgentConfig,
  model?: Model,                          // optional: pass directly to avoid re-lookup
  options?: { applyMultiplier?: boolean } // default: { applyMultiplier: false }
): CostBreakdown
```

`applyMultiplier: false` (default) preserves current behavior exactly — the existing page.tsx caller is unmodified.

**Model resolution (preserve existing behavior):** when `model` is `undefined`, fall back to `MODELS.find(m => m.id === config.modelId)` and `throw new Error("Model not found")` if absent — this is the current `calculateCost` behavior and MUST be kept. When `model` is passed, use it directly (skip the lookup).

### 2.2 Effective output tokens

When `applyMultiplier: true`, replace the output token count used for billing:

```ts
const effectiveOutputTokens = options?.applyMultiplier
  ? config.outputTokensPerRun * model.outputMultiplier
  : config.outputTokensPerRun;

const outputCost = (effectiveOutputTokens / 1_000_000) * model.outputPricePerM;
```

All other cost components (input, cache read, cache write, tool calls) are unchanged — they do not scale with the output multiplier.

### 2.3 `CostBreakdown` extension

Add one field so the UI can display what happened:

```ts
export type CostBreakdown = {
  // ... existing fields unchanged ...
  effectiveOutputTokens: number;
  // equals outputTokensPerRun when applyMultiplier=false
  // equals outputTokensPerRun * model.outputMultiplier when applyMultiplier=true
};
```

---

## 3. Counterfactual engine — `src/lib/counterfactual.ts` (S3)

### 3.1 Types

**[Gate fix — import]** The import must include `calculateCost` in addition to the types, because §3.2 calls `calculateCost(config, model, { applyMultiplier: true })`. `calculateCost` is defined in `models.ts`, not in `counterfactual.ts`. A coding agent using only the type imports would get a compile error on first build.

```ts
import { AgentConfig, Model, CostBreakdown, calculateCost, MODELS } from "./models";

export type Projection = {
  model: Model;
  breakdown: CostBreakdown;          // computed with applyMultiplier: true
  effectiveOutputTokens: number;     // config.outputTokensPerRun * model.outputMultiplier
                                     // INTENTIONAL convenience duplicate of breakdown.effectiveOutputTokens
                                     // (§2.3) — same value; surfaced at top level so the UI need not reach
                                     // into breakdown. Implementer must set both to the same number.
  multiplierUsed: number;            // model.outputMultiplier at time of computation
  isAnchor: boolean;                 // true when model.id === config.modelId
  deltaVsAnchorPct: number | null;   // null for the anchor row itself
  // Formula: ((this.totalPerMonth - anchor.totalPerMonth) / anchor.totalPerMonth) * 100
  // Negative = cheaper than anchor; positive = more expensive.
};
```

### 3.2 `projectCounterfactual`

```ts
export function projectCounterfactual(
  config: AgentConfig,
  models?: Model[]         // defaults to MODELS from models.ts
): Projection[]
```

**Behavior**:
1. Use `models ?? MODELS`. Filter nothing — caller controls the set.
2. For each model: call `calculateCost(config, model, { applyMultiplier: true })`.
3. Identify the anchor: `model.id === config.modelId`. If no model matches `config.modelId` (trace came from an unknown model), anchor = `undefined`; all `deltaVsAnchorPct` are `null`.
4. Compute `deltaVsAnchorPct` against the anchor's `totalPerMonth`.
5. Sort result cheapest-first by `breakdown.totalPerMonth`.
6. Return the full array (anchor is inline at its natural sort position, marked `isAnchor: true`).

**Precision**: `deltaVsAnchorPct` rounded to one decimal place in the return value (not in intermediate math).

**Edge cases**:
- Anchor `totalPerMonth === 0` (free model or zero-cost config): set all `deltaVsAnchorPct` to `null` — division by zero is not meaningful.
- Unknown model ID in config: anchor is `undefined`; all deltas `null`; `isAnchor` is `false` for all rows.

### 3.3 `cacheRateInsight`

```ts
export type CacheRateInsight = {
  measured: number;            // config.cacheHitRate (the observed rate, 0–1)
  atNinety: number;            // 0.90 (constant — the "what-if" target)
  monthlySavingAtNinety: number; // see math below
};

export function cacheRateInsight(config: AgentConfig): CacheRateInsight
```

**Math** — `monthlySavingAtNinety`:

The only cost component that changes with cache rate is the input side (cached vs uncached reads and cache writes). Compute the difference between current-rate monthly cost and 90%-rate monthly cost, holding the anchor model and all other config fields constant.

```
model = MODELS.find(m.id === config.modelId)   // anchor model
// GUARD: if model is undefined (config.modelId not in MODELS — possible when called
// directly with a hand-entered config), return { measured: config.cacheHitRate,
// atNinety: 0.90, monthlySavingAtNinety: 0 } instead of dereferencing model.* (which
// would throw a TypeError). The trace-parsed path can't hit this (parsedRunToConfig
// defaults modelId to claude-sonnet-4-6), but the direct-call path can.
totalInput = config.systemPromptTokens + config.inputTokensPerRun

// At current measured rate:
cachedTokens_now    = totalInput * config.cacheHitRate
uncachedTokens_now  = totalInput - cachedTokens_now
inputCost_now       = (uncachedTokens_now / 1e6) * model.inputPricePerM
cacheReadCost_now   = (cachedTokens_now / 1e6)  * (model.cacheReadPricePerM ?? 0)
cacheWriteCost_now  = (config.systemPromptTokens / 1e6) * (model.cacheWritePricePerM ?? 0)
                        * (1 - config.cacheHitRate)    // only when writing a new cache entry
totalInputCost_now  = inputCost_now + cacheReadCost_now + cacheWriteCost_now

// At 90% rate:
cachedTokens_90     = totalInput * 0.90
uncachedTokens_90   = totalInput - cachedTokens_90
inputCost_90        = (uncachedTokens_90 / 1e6) * model.inputPricePerM
cacheReadCost_90    = (cachedTokens_90  / 1e6)  * (model.cacheReadPricePerM ?? 0)
cacheWriteCost_90   = (config.systemPromptTokens / 1e6) * (model.cacheWritePricePerM ?? 0)
                        * (1 - 0.90)
totalInputCost_90   = inputCost_90 + cacheReadCost_90 + cacheWriteCost_90

// Saving per run × runs/day × 30 days:
monthlySavingAtNinety = (totalInputCost_now - totalInputCost_90) * config.runsPerDay * 30
```

`monthlySavingAtNinety` can be negative (if model has no cache support or current rate > 90%) — the UI should clamp display to ≥ $0 but the raw value is returned as-is.

For models where `supportsCache: false` or `cacheReadPricePerM` is undefined: `monthlySavingAtNinety` will naturally compute to `0` or a small value — no special-casing needed.

---

## 4. UI contract — Nominal ⇄ Effective toggle (S4 reference)

This section is a contract for the S4 implementer; the spec does not implement UI.

### 4.1 Toggle behavior

Two modes, persisted in local React state (default = Effective):

| Mode | `applyMultiplier` passed to `calculateCost` | Table label |
|---|---|---|
| **Effective** (default) | `true` | "Effective cost (normalized by verbosity)" |
| **Nominal** | `false` | "Nominal cost (per-token rate only)" |

When Effective is active:
- Sort and Δ% column use `breakdown.totalPerMonth` from `projectCounterfactual` (which uses `applyMultiplier: true`).
- Each row shows `effectiveOutputTokens` in a sub-row or tooltip.

When Nominal is active:
- Re-run `calculateCost(config, model, { applyMultiplier: false })` for each model directly (or call `projectCounterfactual` with a config that has `outputMultiplier` overridden to 1.0 — implementer's choice).

### 4.2 Multiplier tooltip

Every row in the counterfactual table surfaces a tooltip on the multiplier cell:

```
{model.name}: {model.outputMultiplier}x output verbosity
Source: {model.multiplierSource}
Confidence: {model.multiplierConfidence}
```

For `multiplierConfidence: "low"`: render an amber warning badge ("?") next to the value. GLM-5.1 is the only current case.

### 4.3 Cache-rate reveal banner

Rendered when a trace is parsed and `cacheRateInsight` is computed:

```
Your measured cache hit rate: {(measured * 100).toFixed(0)}%
At 90% you'd save {formatCost(monthlySavingAtNinety)}/mo
```

If `monthlySavingAtNinety <= 0` or model does not support cache: suppress the second sentence.
If `measured >= 0.90`: replace with "Cache hit rate is already at or above 90% — well optimized."

---

## 5. Test contracts (S5 reference)

The spec does not write tests, but defines what assertions must hold:

### `calculateCost` with `applyMultiplier: true`

**[Gate fix — Haiku price]** `claude-haiku-4-5.outputPricePerM` in `src/lib/models.ts` is `5.0`, not `0.8`.
The prior spec used `0.8` and derived `outputCost = $0.000472`. The correct figure is `$0.00295`.
Hard-code the values below — do not look up prices at test runtime, because prices may change.

For Claude Opus 4.7 (`outputMultiplier: 7.9`, `outputPricePerM: 25.0`), given `outputTokensPerRun: 1000`:

```
effectiveOutputTokens = 1000 * 7.9 = 7900
outputCost            = (7900 / 1_000_000) * 25.0 = $0.1975 per run
```

For Claude Haiku 4.5 (`outputMultiplier: 0.59`, `outputPricePerM: 5.0`), given `outputTokensPerRun: 1000`:

```
effectiveOutputTokens = 1000 * 0.59 = 590
outputCost            = (590 / 1_000_000) * 5.0 = $0.00295 per run
```

> A test asserting `$0.000472` would silently validate an incorrect implementation (or silently
> cause a coding agent to write the wrong price into `models.ts`). The correct value is `$0.00295`.

### `projectCounterfactual` sort + anchor

Given `config.modelId = "claude-sonnet-4-6"` and all 16 models: the anchor row (`isAnchor: true`) has `deltaVsAnchorPct: null`. Rows cheaper than Sonnet have negative delta; rows more expensive have positive delta. Result is sorted cheapest-to-most-expensive by `totalPerMonth`.

### `cacheRateInsight` — Claude Sonnet 4.6 example

```
config.cacheHitRate        = 0.38
config.systemPromptTokens  = 10_000
config.inputTokensPerRun   = 5_000
config.runsPerDay          = 100
model                      = claude-sonnet-4-6
  inputPricePerM            = 3.0
  cacheReadPricePerM        = 0.30
  cacheWritePricePerM       = 3.75

totalInput = 15_000

// Current (38%):
cachedTokens_now   = 15000 * 0.38 = 5700
uncachedTokens_now = 9300
inputCost_now      = (9300 / 1e6) * 3.0       = $0.0279
cacheReadCost_now  = (5700 / 1e6) * 0.30      = $0.00171
cacheWriteCost_now = (10000 / 1e6) * 3.75 * 0.62 = $0.023250
totalInputCost_now = $0.052860

// At 90%:
cachedTokens_90   = 15000 * 0.90 = 13500
uncachedTokens_90 = 1500
inputCost_90      = (1500 / 1e6) * 3.0        = $0.0045
cacheReadCost_90  = (13500 / 1e6) * 0.30      = $0.00405
cacheWriteCost_90 = (10000 / 1e6) * 3.75 * 0.10 = $0.003750
totalInputCost_90 = $0.012300

saving_per_run = $0.052860 - $0.012300 = $0.040560
monthlySavingAtNinety = $0.040560 * 100 * 30 = $121.68/mo
```

---

## 6. What this spec does NOT cover

- S2 (`parseTrace`, `parsedRunToConfig`) — see BUILD-PLAN §S2 and SPEC-trace-parser.md.
- S4 UI implementation details beyond the toggle/tooltip/banner contract above.
- S5 test file structure — see BUILD-PLAN §S5.
- Any backend, persistence, or shareable URL feature.
- Non-Anthropic/Claude-Code trace formats (out of scope per BUILD-PLAN).

---

## 7. Open questions (parking lot)

| # | Question | Default until resolved |
|---|---|---|
| OQ-1 | GPT-5.5 lower effort tiers (high/med/low): no AA token counts published. Build a reasoning-effort sub-toggle? | Do NOT build. Use 5.4x (xhigh) only. Surface in tooltip. |
| OQ-2 | DeepSeek V4 Pro / Flash non-reasoning multiplier: AA does not publish these. | Do NOT expose non-reasoning toggle until independently sourced. |
| OQ-3 | GLM-5.1 reasoning measurement: AA shows N/A. | 1.0 placeholder + "low" badge. Replace when measured. |
| OQ-4 | Tool-call tokens: do they scale with output verbosity? | No — tool calls are modeled as input tokens (bidirectional avg). Do not apply `outputMultiplier` to tool call cost. |

---

## Appendix A: Gate-fix log (2026-05-30)

Three issues in the prior version of these specs that would cause a coding agent to produce wrong or un-compilable output:

**Fix 1 — §5 Haiku `outputPricePerM` (this file)**
- Prior: `outputPricePerM: 0.8`, `outputCost = (590 / 1e6) * 0.8 = $0.000472`
- Actual in `models.ts` (grep: `claude-haiku-4-5`, `outputPricePerM: 5.0`): price is `5.0`
- Corrected: `outputCost = (590 / 1e6) * 5.0 = $0.00295`
- Blast radius: a coding agent copying `0.8` into `models.ts` underprices Haiku by 6.25x; a test asserting `$0.000472` silently validates that broken state.

**Fix 2 — §3.1 Missing `calculateCost` import (this file)**
- Prior: `import { AgentConfig, Model, CostBreakdown } from "./models"` — `calculateCost` absent
- §3.2 calls `calculateCost(config, model, { applyMultiplier: true })`; `calculateCost` lives in `models.ts`
- Corrected: `import { AgentConfig, Model, CostBreakdown, calculateCost, MODELS } from "./models"`
- Blast radius: compile error on first build of `counterfactual.ts`.

**Fix 3 — SPEC-trace-parser.md §7 `detectFormat` inconsistency**
- Prior step 3: classifies `{` / `[` input as `'anthropic-json'` **only if** the parsed result has a `.usage` key
- Consequence for `{"role":"assistant","content":"hello"}` (no `.usage`):
  - Step 3 fails (no `.usage`) → not classified as `anthropic-json`
  - Step 4 fails (no `"type":"assistant"` line — this is a single-line non-jsonl string)
  - Step 5 does not fire (parse succeeded, no throw yet)
  - Step 6 falls through to `'jsonl'` → parser tries line-by-line → finds no assistant turns → throws `NO_ASSISTANT_TURNS`
  - But Case 6 test expects `NO_USAGE_FIELDS` — the algorithm as written cannot reach that branch
- Corrected step 3: classify any successfully-parsed `{` or `[` input as `'anthropic-json'` regardless of `.usage` presence; the subsequent parse step (after detection) checks for `.usage` and throws `NO_USAGE_FIELDS` when absent
- Fix location: SPEC-trace-parser.md §7 — applied there; recorded here for cross-spec traceability.
