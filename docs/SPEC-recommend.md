# SPEC — Recommendation Engine: C3 + C4 Implementation Contract

> Written: 2026-05-30
> Covers: C3 (capability-score extension to `Model`) and C4 (`recommend.ts`)
> Source truth: BUILD-PLAN-task-classifier.md (requirements), RESEARCH-capability-matrix.md (data),
>   src/lib/models.ts (existing types), src/lib/counterfactual.ts (reused engine)
>
> Gate issues fixed in this revision:
>   B1 — monthlySaving false non-negative guarantee (§3.1 + Step 6b in §4.2)
>   B2 — `signals` field optionality in ParsedRun (§1.2 note + §6.5 fixture note)
>   B3 — Case 1 agentic score comment arithmetic (§8)
>   B4 — Case 4 coding score comment omits repairSignals contribution (§8)

---

## 1. Model capability-score extension (C3)

### 1.1 New type

Add to `src/lib/models.ts` (additive — existing fields untouched):

```ts
export type CapabilityScores = {
  coding:    number;  // 0–100, see scoring calibration below
  reasoning: number;  // 0–100
  general:   number;  // 0–100
};

export type CapabilityConfidence = "high" | "med" | "low";

export type ModelCapability = {
  scores:     CapabilityScores;
  confidence: {
    coding:    CapabilityConfidence;
    reasoning: CapabilityConfidence;
    general:   CapabilityConfidence;
  };
};
```

### 1.2 Extension to `Model`

```ts
export type Model = {
  // ... all existing fields unchanged ...
  capability?: ModelCapability;
  // Optional for backward compat. Models without capability data are excluded
  // from recommendations (treated as "anchor unknown" — see §4.3).
};
```

The field is optional so no existing callers break. `recommend()` guards against
missing capability data explicitly (see §4.3).

> **B2 note — `ParsedRun.signals` optionality**: C1 adds a `signals` field to
> `ParsedRun`. That field MUST be declared as `signals?: { ... }` (with the `?`
> optional marker). Reason: existing test fixtures in `parseTrace.test.ts` (the
> `parsedRunToConfig` suite, lines 230–272) construct `ParsedRun` objects without
> a `signals` field. If `signals` is declared required (no `?`), TypeScript will
> refuse to compile those fixtures after C1 lands, even though `parseTrace()` itself
> always populates the field at runtime. The "additive" claim holds at the runtime
> level; the type must reflect it via optional declaration.
>
> Acceptable alternative: if the implementor prefers a required field, C1's
> acceptance criteria MUST explicitly include updating every manual `ParsedRun`
> construction in `parseTrace.test.ts` to include a `signals` block. Document
> whichever path is taken in the C1 PR description.

### 1.3 Score calibration (from RESEARCH-capability-matrix.md)

Scores are approximate percentile rank against the 2026 production LLM population,
calibrated to published benchmark data (Artificial Analysis Intelligence Index v4.0,
SWE-bench Verified, GPQA Diamond, MMLU/MMLU-Pro/IFEval). Scale:

| Range | Interpretation |
|-------|---------------|
| 90–100 | Top-3 globally on primary domain benchmark (May 2026) |
| 80–89 | Clearly frontier-tier; beats GPT-4-class models solidly |
| 70–79 | Strong mid-tier; capable of complex tasks with occasional gaps |
| 60–69 | Competent; handles standard tasks well, struggles at highest complexity |
| 50–59 | Mid-budget tier; adequate for low/med complexity tasks |
| 30–49 | Budget tier; best suited for simple, well-structured tasks |
| 0–29 | Not recommended for domain-specific work |

### 1.4 Per-model values

Use exactly these values from RESEARCH-capability-matrix.md. Do not re-derive.

```ts
// Append to each model entry in MODELS[]:

// claude-opus-4-7
capability: {
  scores:     { coding: 92, reasoning: 90, general: 88 },
  confidence: { coding: "high", reasoning: "high", general: "high" },
},

// claude-sonnet-4-6
capability: {
  scores:     { coding: 85, reasoning: 74, general: 82 },
  confidence: { coding: "high", reasoning: "high", general: "high" },
},

// gpt-5.5
capability: {
  scores:     { coding: 91, reasoning: 91, general: 90 },
  confidence: { coding: "high", reasoning: "high", general: "high" },
},

// gemini-3.1-pro
capability: {
  scores:     { coding: 85, reasoning: 92, general: 87 },
  confidence: { coding: "high", reasoning: "high", general: "high" },
},

// deepseek-v4-pro
capability: {
  scores:     { coding: 88, reasoning: 82, general: 78 },
  confidence: { coding: "high", reasoning: "high", general: "med" },
},

// kimi-k2.6
capability: {
  scores:     { coding: 84, reasoning: 80, general: 75 },
  confidence: { coding: "high", reasoning: "high", general: "med" },
},

// claude-haiku-4-5
// NOTE: coding score (50) reflects non-reasoning mode only, consistent with
// outputMultiplier=0.59. High-reasoning mode reaches 67% but that is NOT the
// priced deployment mode and MUST NOT be used here.
capability: {
  scores:     { coding: 50, reasoning: 58, general: 65 },
  confidence: { coding: "med", reasoning: "med", general: "med" },
},

// gpt-5.4-mini
// NOTE: coding score (66) is a conservative estimate — BenchLM flags insufficient
// overlapping benchmark coverage. confidence: "low" on coding reflects this gap.
capability: {
  scores:     { coding: 66, reasoning: 60, general: 70 },
  confidence: { coding: "low", reasoning: "med", general: "med" },
},

// gemini-3-flash
capability: {
  scores:     { coding: 72, reasoning: 70, general: 72 },
  confidence: { coding: "high", reasoning: "med", general: "med" },
},

// grok-4.1-fast
// NOTE: coding is the known weak dimension (#44/117 in BenchLM). Long-context
// retrieval is strong but that is not reflected in the floor system.
capability: {
  scores:     { coding: 58, reasoning: 68, general: 65 },
  confidence: { coding: "med", reasoning: "med", general: "med" },
},

// qwen-3.6-plus
capability: {
  scores:     { coding: 78, reasoning: 76, general: 73 },
  confidence: { coding: "high", reasoning: "high", general: "med" },
},

// glm-5.1
// NOTE: general score (65) is low-confidence — no reasoning-mode general/knowledge
// data on Artificial Analysis. Actual may be higher.
capability: {
  scores:     { coding: 72, reasoning: 68, general: 65 },
  confidence: { coding: "med", reasoning: "med", general: "low" },
},

// deepseek-v4-flash
// NOTE: coding score (68) = default deployment only (non-extended-thinking).
// Max-effort extended thinking achieves near-parity with V4 Pro (80.6%) but that
// token burn is already captured by outputMultiplier=17.1x — capability score
// intentionally does NOT reflect max-effort mode.
capability: {
  scores:     { coding: 68, reasoning: 62, general: 58 },
  confidence: { coding: "med", reasoning: "med", general: "med" },
},

// llama-3.3-70b
capability: {
  scores:     { coding: 52, reasoning: 48, general: 55 },
  confidence: { coding: "med", reasoning: "med", general: "med" },
},

// minimax-m2.7
capability: {
  scores:     { coding: 58, reasoning: 55, general: 56 },
  confidence: { coding: "med", reasoning: "med", general: "med" },
},

// mistral-large-2
// NOTE: benchmarks are from 2024 release; scored against 2026 competition.
// This explains budget-tier placement despite strong 2024 numbers.
capability: {
  scores:     { coding: 60, reasoning: 52, general: 60 },
  confidence: { coding: "med", reasoning: "med", general: "med" },
},
```

---

## 2. CAPABILITY_FLOOR table structure

### 2.1 Type

Add to `src/lib/recommend.ts`:

```ts
import type { TaskType, Complexity } from "./classifyTask";

type FloorCell = {
  coding:    number;  // minimum required coding score; 0 = no constraint
  reasoning: number;  // minimum required reasoning score
  general:   number;  // minimum required general score
};

type CapabilityFloor = Record<TaskType, Record<Complexity, FloorCell>>;
```

A `coding: 0` floor means coding capability is not a gating factor for the task type
(any value clears the constraint). The engine applies the check as `score >= floor`,
treating 0 as always-satisfied.

### 2.2 Table values (from RESEARCH-capability-matrix.md, exact)

A model must clear ALL three domain floors simultaneously to be eligible for
recommendation in a given (taskType, complexity) cell.

```ts
export const CAPABILITY_FLOOR: CapabilityFloor = {
  coding: {
    low:  { coding: 50, reasoning: 40, general: 45 },
    // Single-function generation, bug fixes with clear stack trace.
    // Budget tier sufficient. Minimum exemplar: Llama 3.3 70B (coding=52).
    med:  { coding: 68, reasoning: 55, general: 55 },
    // Multi-file edits, test writing, API integration.
    // DeepSeek V4 Flash (coding=68) is the minimum viable exemplar.
    // Haiku 4.5 (coding=50) and Grok 4.1 Fast (coding=58) fall below.
    high: { coding: 82, reasoning: 72, general: 70 },
    // Repository-level refactoring, agentic SWE-bench-style tasks.
    // Minimum exemplar: DeepSeek V4 Pro (coding=88, reasoning=82, general=78).
    // Kimi K2.6 (reasoning=80) meets reasoning floor but coding=84 ≥ 82 clears.
  },
  extraction: {
    low:  { coding:  0, reasoning: 35, general: 50 },
    // Structured field extraction, simple JSON parsing. Budget tier.
    med:  { coding:  0, reasoning: 45, general: 62 },
    // Schema-constrained extraction, nested structures, type coercion.
    // IFEval-class instruction-following required.
    high: { coding:  0, reasoning: 55, general: 72 },
    // Multi-document extraction with ambiguity resolution.
    // Minimum exemplar: Gemini 3 Flash (general=72).
  },
  research: {
    low:  { coding:  0, reasoning: 45, general: 55 },
    // Single-source summarization, FAQ answering. Factual recall + fluency.
    med:  { coding:  0, reasoning: 60, general: 68 },
    // Multi-source synthesis, citation, comparison. Grok 4.1 Fast fails
    // (general=65 < 68). Gemini 3 Flash (r70/g72) and GPT-5.4 mini (r60/g70) pass.
    high: { coding:  0, reasoning: 78, general: 82 },
    // Cross-domain synthesis, adversarial claim verification, long multi-doc.
    // Only frontier clears both floors: Claude Opus 4.7, GPT-5.5, Gemini 3.1 Pro.
    // Kimi K2.6 (general=75) and DeepSeek V4 Pro (general=78) fall short of
    // the general floor.
  },
  agentic: {
    low:  { coding: 55, reasoning: 52, general: 58 },
    // Simple tool-use loop: 1-3 tool calls, well-defined success criterion.
    med:  { coding: 68, reasoning: 65, general: 68 },
    // Multi-tool chains (5-15 calls), conditional branching, error recovery.
    // Minimum exemplar: Gemini 3 Flash (coding=72, reasoning=70, general=72).
    // Haiku 4.5 fails reasoning (58 < 65) and general (65 < 68).
    high: { coding: 82, reasoning: 80, general: 78 },
    // Long-horizon agentic tasks, 20+ tool calls, ambiguous termination.
    // Clears: Opus 4.7, GPT-5.5, Gemini 3.1 Pro, DeepSeek V4 Pro (general=78).
    // Kimi K2.6 (general=75) does NOT qualify.
  },
  reasoning: {
    low:  { coding:  0, reasoning: 48, general: 50 },
    // Basic deduction, logic puzzles. Llama 3.3 70B (reasoning=48) at minimum.
    med:  { coding:  0, reasoning: 65, general: 60 },
    // Multi-step logical inference, structured argumentation, basic math.
    // Grok 4.1 Fast / Gemini Flash tier.
    high: { coding:  0, reasoning: 80, general: 72 },
    // PhD-level reasoning, GPQA Diamond class, competition math.
    // Kimi K2.6 (reasoning=80) is the minimum exemplar.
  },
  chat: {
    low:  { coding:  0, reasoning: 35, general: 50 },
    // FAQ bots, simple Q&A, templated responses. Any budget model.
    med:  { coding:  0, reasoning: 45, general: 62 },
    // Customer support, open-domain conversation, content generation.
    // Minimum exemplars (general≥62): Haiku 4.5 (65), Grok 4.1 Fast (65).
    // Llama 3.3 70B (55) and MiniMax M2.7 (56) fall short.
    high: { coding:  0, reasoning: 58, general: 75 },
    // Domain-expert chat, nuanced tone-matching, long personalized conversations.
    // general≥75 excludes Gemini 3 Flash (72), Qwen 3.6 Plus (73), GPT-5.4 mini (70).
    // Minimum exemplar: Kimi K2.6 (general=75, exactly clears).
  },
} as const;
```

---

## 3. `Recommendation` type

```ts
// src/lib/recommend.ts

export type Recommendation = {
  current:        Model;         // anchor model from the parsed trace
  recommended:    Model | null;  // cheapest capable model; null if anchor already optimal
  monthlySaving:  number;        // positive = saving vs anchor; 0 when recommended is null
  rationale:      string;        // one-line explanation of the verdict
  caveats:        string[];      // confidence/data-quality notes surfaced to the user
};
```

### 3.1 monthlySaving sign convention

`monthlySaving` is always non-negative when `recommended !== null`:

- When `recommended !== null`: `anchorMonthly - recommendedMonthly`, which is guaranteed
  positive **only when** the cheapest capable model is cheaper than the anchor. This holds
  in the common case (anchor model clears the floor and a cheaper alternative also clears
  it) but fails when the anchor itself fails the capability floor: `capableModels` then
  contains only models that DO clear the floor, and the cheapest of those may cost more
  than the anchor. In that scenario, `anchorMonthly - cheapestCapable.totalPerMonth`
  would be negative. The algorithm guards against this in Step 6.5 (see §4.2) — when no
  cheaper capable model exists, the function returns `recommended: null` with a "no
  cheaper capable alternative" rationale rather than emitting a negative saving.
- When `recommended === null` (anchor already optimal, anchor fails floor with no cheaper
  alternative, or no model clears the floor): `0`.
- Rounding: two decimal places (`Math.round(value * 100) / 100`).

**Implementation invariant**: `monthlySaving` must never be negative. The Step 6.5 guard
enforces this. A coding agent implementing this spec must NOT skip Step 6.5.

---

## 4. `recommend()` algorithm

### 4.1 Function signature

```ts
import { ParsedRun } from "./parseTrace";
import { AgentConfig, Model, MODELS } from "./models";
import { Classification } from "./classifyTask";
import { projectCounterfactual } from "./counterfactual";

export function recommend(
  p: ParsedRun,
  cls: Classification,
  config: AgentConfig,
): Recommendation
```

### 4.2 Algorithm (step-by-step)

```
Step 1 — resolve anchor
  anchorModel = MODELS.find(m => m.id === config.modelId)
  if anchorModel is undefined → return anchor-unknown result (§4.3)

Step 2 — get effective costs for all models (reuse projectCounterfactual)
  projections = projectCounterfactual(config, MODELS)
  // projections is sorted cheapest-first, applyMultiplier: true applied to all rows

Step 3 — identify anchor cost
  anchorProjection = projections.find(p => p.isAnchor)
  anchorMonthly = anchorProjection.breakdown.totalPerMonth

Step 4 — resolve the relevant floor cell
  floor = CAPABILITY_FLOOR[cls.taskType][cls.complexity]
  // cls.taskType: TaskType, cls.complexity: Complexity — both from classifyTask()

Step 5 — filter to capable models
  capableModels = projections.filter(proj => {
    cap = proj.model.capability
    if cap is undefined → exclude (no benchmark data; conservative)
    return (
      cap.scores.coding    >= floor.coding    &&  // 0-floor = always passes
      cap.scores.reasoning >= floor.reasoning &&
      cap.scores.general   >= floor.general
    )
  })
  // Note: CAPABILITY_FLOOR cells with coding: 0 are satisfied by any coding score
  // because any non-negative number >= 0.

Step 5.5 — EMPTY GUARD: no model clears the floor (MUST run before Step 6)
  if capableModels.length === 0:
    → return {
        current:       anchorModel,
        recommended:   null,
        monthlySaving: 0,
        rationale:     `No model in the lineup clears the ${cls.complexity}-${cls.taskType} capability floor (coding≥${floor.coding} / reasoning≥${floor.reasoning} / general≥${floor.general}); staying on ${anchorModel.name}.`,
        caveats:       ["No model meets the capability floor for this task — the classification may be too strict; use the override control."],
      }
  // Without this guard, Step 6 assigns capableModels[0] = undefined and Step 6.5
  // dereferences undefined.breakdown → TypeError. This is the §4.4 Sub-case B path,
  // now made explicit in the canonical step sequence (was prose-only in §4.4).

Step 6 — pick cheapest capable model
  // projections is already sorted cheapest-first, so iterate in order
  cheapestCapable = capableModels[0]  // first entry is the cheapest after sort
  // (projections sorted by totalPerMonth ascending in projectCounterfactual)

Step 6.5 — guard: no cheaper capable model exists
  // This fires when the anchor FAILS the capability floor and every model that
  // DOES clear the floor costs MORE than the anchor. Concrete example:
  //   anchor=deepseek-v4-flash ($167/mo, reasoning=62 < agentic/med floor 65)
  //   cheapestCapable=gemini-3-flash ($586/mo)
  //   anchorMonthly - cheapestCapable.totalPerMonth = 167 - 586 = -418 (NEGATIVE)
  // Without this guard a coding agent emits monthlySaving = -418.
  if cheapestCapable.breakdown.totalPerMonth > anchorMonthly:
    → return {
        current:       anchorModel,
        recommended:   null,
        monthlySaving: 0,
        rationale:     `${anchorModel.name} does not clear the ${cls.complexity}-${cls.taskType} capability floor, but no capable alternative is cheaper — switching would increase cost. Manual model selection recommended.`,
        caveats:       [
          `Anchor model ${anchorModel.name} does not meet the capability floor for ${cls.complexity} ${cls.taskType} tasks (floor: coding≥${floor.coding} / reasoning≥${floor.reasoning} / general≥${floor.general}).`,
          "All models that clear the floor cost more than the current anchor. This may indicate the task complexity is mis-classified — use the override control.",
        ],
      }

Step 7 — check if anchor already optimal
  if cheapestCapable.model.id === anchorModel.id:
    → return recommended: null (§4.4 "anchor already optimal")

Step 8 — build result
  // At this point cheapestCapable.breakdown.totalPerMonth < anchorMonthly is guaranteed
  // by Step 6.5, so monthlySaving is always positive here.
  monthlySaving = Math.round((anchorMonthly - cheapestCapable.breakdown.totalPerMonth) * 100) / 100
  rationale = build rationale string (§4.5)
  caveats   = build caveats list (§4.6)
  return Recommendation {
    current:       anchorModel,
    recommended:   cheapestCapable.model,
    monthlySaving: monthlySaving,
    rationale:     rationale,
    caveats:       caveats,
  }
```

### 4.3 Edge case: anchor unknown

When `config.modelId` does not match any entry in `MODELS`:

```ts
return {
  current:       { id: config.modelId, name: config.modelId } as Model,
  recommended:   null,
  monthlySaving: 0,
  rationale:     `Anchor model "${config.modelId}" is not in the known model catalog — cannot compare.`,
  caveats:       ["Add this model to models.ts to enable recommendations."],
};
```

Return type is still `Recommendation`. No throw.

### 4.4 Edge case: no capable cheaper model

Three sub-cases that all result in `recommended: null`:

**Sub-case A — anchor already optimal**: the anchor IS the cheapest model among those
clearing the floor. No cheaper capable alternative exists.

```ts
return {
  current:       anchorModel,
  recommended:   null,
  monthlySaving: 0,
  rationale:     `${anchorModel.name} is already the cheapest model clearing the ${cls.complexity}-${cls.taskType} floor (${floor.coding}/${floor.reasoning}/${floor.general}).`,
  caveats:       buildCaveats(cls, capableModels),
};
```

**Sub-case B — no model clears the floor at all** (capableModels is empty):

```ts
return {
  current:       anchorModel,
  recommended:   null,
  monthlySaving: 0,
  rationale:     `No model in the catalog clears the ${cls.complexity}-${cls.taskType} floor. Consider manual selection or lowering complexity tier.`,
  caveats:       ["This is unusual — the floor may be set too high for the current model catalog, or the classification may be inaccurate."],
};
```

**Sub-case C — anchor fails the floor and no capable model is cheaper** (Step 6.5):
The anchor does not clear the capability floor, and all capable models cost more. This is
handled by the Step 6.5 guard (see §4.2) before reaching the anchor-optimal check in
Step 7. The rationale string explains that switching would increase cost and recommends
manual model selection.

Distinguish all three by checking in order:
1. `capableModels.length === 0` → Sub-case B
2. `cheapestCapable.breakdown.totalPerMonth > anchorMonthly` → Sub-case C (Step 6.5)
3. `cheapestCapable.model.id === anchorModel.id` → Sub-case A

### 4.5 Rationale string format

Rationale is one sentence constructed as:

```
"{complexity} {taskType} task → floor: coding≥{C} / reasoning≥{R} / general≥{G}; 
cheapest model clearing floor: {recommended.name} (saves ${monthlySaving}/mo vs {current.name})."
```

Example:
```
"med coding task → floor: coding≥68 / reasoning≥55 / general≥55; 
cheapest model clearing floor: Gemini 3 Flash (saves $142.50/mo vs Claude Sonnet 4.6)."
```

For `coding: 0` floor dimensions, omit them from the floor display (they are not
gating constraints). Example for extraction/med:
```
"med extraction task → floor: reasoning≥45 / general≥62; 
cheapest model clearing floor: Claude Haiku 4.5 (saves $89.20/mo vs Claude Opus 4.7)."
```

### 4.6 Caveats list

Caveats are derived from the classification confidence and the recommended model's
data quality. Collect any of the following that apply:

| Condition | Caveat string |
|-----------|--------------|
| `cls.taskTypeConfidence < 0.5` | `"Task-type confidence is low (${(cls.taskTypeConfidence * 100).toFixed(0)}%) — override the classifier if this doesn't match your workload."` |
| `cls.complexityConfidence < 0.5` | `"Complexity confidence is low (${(cls.complexityConfidence * 100).toFixed(0)}%) — verify via the override control."` |
| Recommended model has any `capability.confidence` === `"low"` | `"${recommended.name} has low-confidence benchmark data in at least one domain — treat this recommendation as a starting point, not a guarantee."` |
| `cls.taskTypeConfidence < 0.5 || cls.complexityConfidence < 0.5` (either) | Also append: `"Use the override controls to adjust the classification before acting on this recommendation."` |
| Anchor has any `capability.confidence` === `"low"` | `"Anchor model ${current.name} has low-confidence benchmark data — floor comparison may be unreliable."` |

If no caveats apply, return an empty array `[]`.

---

## 5. Saving math — worked examples

These examples validate the implementation. Use as test fixtures for C6.

### Example A — Coding/med: Sonnet 4.6 → Gemini 3 Flash

Config (illustrative):
```
modelId: "claude-sonnet-4-6"
systemPromptTokens: 10_000
inputTokensPerRun: 5_000
outputTokensPerRun: 2_000
toolCallsPerRun: 5
tokensPerToolCall: 500
cacheHitRate: 0.6
runsPerDay: 500
```

Anchor effective cost:
- effectiveOutputTokens = 2000 × 1.0 = 2,000
- Computed via `calculateCost(config, sonnet, { applyMultiplier: true })`

Gemini 3 Flash effective cost:
- effectiveOutputTokens = 2000 × 5.1 = 10,200
- Computed via `calculateCost(config, geminiFlash, { applyMultiplier: true })`

Floor check (coding/med: coding≥68, reasoning≥55, general≥55):
- Gemini 3 Flash: coding=72 ✓, reasoning=70 ✓, general=72 ✓ → passes

monthlySaving = anchorMonthly − geminiFlashMonthly (positive: Gemini 3 Flash is
cheaper per-token even with higher outputMultiplier due to lower price/M).

### Example B — Coding/med: Haiku 4.5 blocked by floor

Haiku 4.5 capability: coding=50, reasoning=58, general=65.
Floor for coding/med: coding≥68. `50 >= 68` → FALSE.
Haiku 4.5 is excluded from capableModels for coding/med.
It MUST NOT appear as the recommended model for this cell.

### Example C — Anchor already optimal: Gemini 3.1 Pro for research/high

Floor for research/high: reasoning≥78, general≥82.
Models clearing floor (from RESEARCH-capability-matrix data):
- Claude Opus 4.7: reasoning=90 ✓, general=88 ✓ → eligible
- GPT-5.5: reasoning=91 ✓, general=90 ✓ → eligible
- Gemini 3.1 Pro: reasoning=92 ✓, general=87 ✓ → eligible

After `projectCounterfactual()` sorts by totalPerMonth ascending, Gemini 3.1 Pro
may rank as cheapest (inputPricePerM=2.0, outputPricePerM=12.0) vs GPT-5.5
(inputPricePerM=5.0, outputPricePerM=30.0) and Opus 4.7 (inputPricePerM=5.0,
outputPricePerM=25.0). Actual cheapest depends on config token counts and
multipliers — the engine computes this live, not by static tier.

If anchor IS Gemini 3.1 Pro and it sorts first → `recommended: null`,
`rationale: "Gemini 3.1 Pro is already the cheapest model clearing the high-research floor…"`.

### Example D — Anchor unknown: "claude-opus-4-6"

`MODELS.find(m => m.id === "claude-opus-4-6")` → undefined (not in catalog).
Returns `recommended: null`, `rationale` includes the unknown-anchor message,
`monthlySaving: 0`.

### Example E — Anchor fails floor, cheapest capable costs more (B1 fix)

This is the canonical example that exposes the B1 bug in the prior spec revision.

```
modelId:             "deepseek-v4-flash"
cls.taskType:        "agentic"
cls.complexity:      "med"

// deepseek-v4-flash capability: coding=68, reasoning=62, general=58
// agentic/med floor:            coding≥68, reasoning≥65, general≥68
// floor check:
//   coding  68 >= 68 ✓
//   reasoning 62 >= 65 ✗ → FAILS floor
// deepseek-v4-flash is excluded from capableModels

// Cheapest model clearing agentic/med floor: gemini-3-flash
//   gemini-3-flash: coding=72 ✓, reasoning=70 ✓, general=72 ✓ → passes

// Illustrative monthly cost at a representative config (exact values depend on config):
//   anchorMonthly        ≈ $167/mo  (deepseek-v4-flash; cheap due to low $/M)
//   cheapestCapable      ≈ $586/mo  (gemini-3-flash; higher $/M + high outputMultiplier)

// Step 6.5 fires: $586 >= $167 → return null, not a negative saving
```

Expected result:
```ts
{
  recommended:   null,
  monthlySaving: 0,
  rationale: "deepseek-v4-flash does not clear the med-agentic capability floor, but no capable alternative is cheaper — switching would increase cost. Manual model selection recommended.",
  caveats: [
    "Anchor model deepseek-v4-flash does not meet the capability floor for med agentic tasks (floor: coding≥68 / reasoning≥65 / general≥68).",
    "All models that clear the floor cost more than the current anchor. This may indicate the task complexity is mis-classified — use the override control.",
  ],
}
```

If the prior algorithm (without Step 6.5) were implemented literally, it would fall
through to Step 8 and return `monthlySaving = 167 - 586 = -419`. This is the B1
false non-negative bug. Step 6.5 prevents this.

---

## 6. Implementation notes

### 6.1 What is reused from counterfactual.ts

`recommend()` calls `projectCounterfactual(config)` directly — it does NOT
re-implement the cost math. `projectCounterfactual` already:
- Calls `calculateCost(config, model, { applyMultiplier: true })` for every model
- Sorts cheapest-first by `totalPerMonth`
- Computes `deltaVsAnchorPct` (ignored by `recommend()` but present)

`recommend()` uses only `projection.model`, `projection.breakdown.totalPerMonth`,
and `projection.isAnchor` from each row.

### 6.2 No re-sorting needed

Because `projectCounterfactual` returns rows sorted by `totalPerMonth` ascending,
the first entry in `capableModels` (which preserves that order) IS the cheapest
capable model. No additional sort step in `recommend()`.

### 6.3 Domain selection for the floor

The floor is always looked up by `(cls.taskType, cls.complexity)` as a pair.
There is no "primary domain" concept in the look-up — the cell specifies all three
domain floors simultaneously and the model must clear all three.

### 6.4 Imports

```ts
// src/lib/recommend.ts — full import block
import { AgentConfig, Model, MODELS } from "./models";
import { ParsedRun } from "./parseTrace";
import { Classification, TaskType, Complexity } from "./classifyTask";
import { projectCounterfactual } from "./counterfactual";
```

`calculateCost` is NOT imported directly into `recommend.ts` — it is called
transitively via `projectCounterfactual`. Do not duplicate cost math.

### 6.5 Test fixtures required (C6)

> **B2 note**: these C6 test fixtures construct `ParsedRun` objects that include a
> `signals` block (they are new tests, not the existing `parseTrace.test.ts` fixtures).
> Whether `signals` is declared required or optional in the type, all C6 fixtures
> must provide a `signals` value. For the existing `parseTrace.test.ts` fixtures
> (which omit `signals`), see the B2 note in §1.2 — those files must remain
> compilable after C1 lands.

| Test name | Setup | Expected |
|-----------|-------|----------|
| `floor enforcement — Haiku blocked for coding/med` | anchor=haiku, cls={coding,med}, any config | `recommended !== haiku`; haiku not in capableModels |
| `anchor already optimal` | anchor=cheapest-capable model for a given cell | `recommended: null`, `monthlySaving: 0` |
| `saving math — positive saving` | anchor=expensive frontier, cls={chat,low} | `monthlySaving > 0`, `recommended.tier !== "frontier"` |
| `anchor unknown` | `config.modelId = "unknown-model-xyz"` | `recommended: null`, rationale contains "not in the known model catalog" |
| `no model clears floor` | Hypothetical floor exceeding all models' scores | `recommended: null`, rationale contains "No model in the catalog clears" |
| `caveats — low confidence` | cls.taskTypeConfidence = 0.3 | caveats.length >= 1, includes override prompt |
| `B1 — anchor fails floor, cheapest capable costs more` | anchor=deepseek-v4-flash, cls={agentic,med}, config where anchor monthly cost < gemini-3-flash monthly cost | `recommended: null`, `monthlySaving: 0`, rationale contains "no capable alternative is cheaper" |

---

## 7. Edge case summary

| Scenario | `recommended` | `monthlySaving` | Rationale trigger |
|----------|--------------|-----------------|-------------------|
| Normal — cheaper capable model found | `Model` | > 0 | Floor + saving |
| Anchor already cheapest capable (anchor clears floor, is cheapest) | `null` | 0 | "already optimal" |
| No model clears the floor | `null` | 0 | "No model clears" |
| Anchor fails floor; all capable models cost more (Step 6.5) | `null` | 0 | "no capable alternative is cheaper" |
| Anchor not in MODELS catalog | `null` | 0 | "not in known catalog" |
| Recommended model has low-confidence data | `Model` | > 0 | Caveat appended, recommendation still returned |

---

## 8. SPEC-task-classifier.md errata (B3 + B4)

The following corrections apply to comments in `docs/SPEC-task-classifier.md §10`
test cases. The test assertions are correct and will pass as written; the bugs are
in the explanatory comments only. Implementors who read the comments as scoring
references will misimplement agentic scoring.

Apply both fixes as direct edits to the comment blocks in `SPEC-task-classifier.md §10`.

### B3 — Case 1: agentic score comment is arithmetically wrong (§10 Case 1)

Prior (buggy) comment that was in SPEC-task-classifier.md:
```
// agentic score: totalToolCalls min(13*0.8, 24)=10.4 + turnCount 3-5 → +2.0
//               + mixed groups: file_edit+bash+file_read = 3 groups → +2.0 = 14.4
```

Two errors:

**Error 1**: `turnCount=3` does NOT clear the `≥ 5` threshold in agentic task-type
scoring (SPEC-task-classifier.md §7.3 `agentic` table: "turnCount ≥ 5 → +2.0").
turnCount=3 → zero bonus. The comment copies the complexity-band language from §8.1
("med: 3–5 turns → 1 pt") and incorrectly applies it to agentic task-type scoring.

**Error 2**: `repairSignals=1` contributes `+1.5` to the agentic score under the rule
"`repairSignals +1.5 per signal` (cap 6.0)" — omitted from the comment entirely.

Correct agentic score for Case 1:
```
totalToolCalls: min(13 × 0.8, 24) = 10.4
turnCount=3, does NOT clear ≥ 5 threshold → +0
repairSignals=1: 1 × 1.5 = +1.5 (cap not reached)
tool diversity: file_edit + bash + file_read = 3 groups → +2.0
agentic total = 10.4 + 0 + 1.5 + 2.0 = 13.9   (not 14.4)
```

Corrected comment to substitute in SPEC-task-classifier.md Case 1:
```ts
  // agentic score: totalToolCalls min(13*0.8, 24)=10.4
  //               + turnCount=3, does NOT clear ≥5 threshold → +0
  //               + repairSignals=1 → 1×1.5=1.5
  //               + mixed groups: file_edit+bash+file_read = 3 groups → +2.0
  //               = 13.9
  // coding wins (32.5 vs 13.9) by wide margin; confidence high
```

The test assertion (`taskType === "coding"`, `taskTypeConfidence > 0.5`) is correct
regardless: coding=32.5 beats agentic=13.9 by 18.6 points → normalized confidence
= min(18.6/10, 1.0) = 1.0. The assertion passes under both the old comment and the
corrected score.

### B4 — Case 4: coding score comment omits repairSignals +1.0 (§10 Case 4)

Prior (buggy) comment that was in SPEC-task-classifier.md:
```
// coding score: bash min(5×2,10)=10 + file_read min(4×0.5,3)=2.0 = 12.0
```

With `repairSignals=3` (≥ 2 threshold), the coding rule "repairSignals ≥ 2 → +1.0"
fires. Actual coding score:
```
bash:          min(5 × 2, 10) = 10
file_read:     min(4 × 0.5, 3) = 2.0
repairSignals=3 ≥ 2 → +1.0
coding total = 10 + 2.0 + 1.0 = 13.0   (not 12.0)
```

The test assertion (`taskType === "agentic"`) is correct regardless: agentic=27.1
beats coding=13.0 by 14.1 points. The assertion passes under both the old and
corrected score.

Corrected comment to substitute in SPEC-task-classifier.md Case 4:
```ts
  // coding score: bash min(5×2,10)=10 + file_read min(4×0.5,3)=2.0
  //               + repairSignals=3 ≥ 2 → +1.0 = 13.0
  // agentic wins (27.1 vs 13.0)
```

---

## Source authority

| Data | Source |
|------|--------|
| Capability scores | `RESEARCH-capability-matrix.md` §Per-Model Capability Scores |
| Floor matrix values | `RESEARCH-capability-matrix.md` §Floor Matrix — Compact Form |
| Floor rationale | `RESEARCH-capability-matrix.md` §Capability Floor Matrix |
| `Recommendation` type + algorithm contract | `BUILD-PLAN-task-classifier.md` C4 |
| Cost engine reuse | `src/lib/counterfactual.ts` `projectCounterfactual` |
| `calculateCost` signature | `src/lib/models.ts` (applyMultiplier: true) |
| B1 fix — Step 6.5 guard + Sub-case C | This document §3.1, §4.2 Step 6.5, §4.4, §5 Example E |
| B2 fix — `signals` optionality | This document §1.2 note, §6.5 fixture note |
| B3 fix — Case 1 agentic comment | This document §8 (B3); apply to `SPEC-task-classifier.md §10 Case 1` |
| B4 fix — Case 4 coding comment | This document §8 (B4); apply to `SPEC-task-classifier.md §10 Case 4` |
