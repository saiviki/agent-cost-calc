# Build Plan — Task DNA Classifier + Capability-Aware Recommendation

> The differentiator layer. Builds ON TOP of the (uncommitted) trace-counterfactual feature.
> Philosophy: **measure, don't ask** — classify the task from the trace's behavioral signature, then recommend the cheapest model that clears a benchmark-grounded capability floor for that task profile.
> Constraints: **client-side heuristic only** (no ML model, no backend, no API key), **additive**, **do NOT commit / push**, transparent (every verdict shows its evidence + confidence + a user override).

## Hero output
A "Task DNA" card: detected **task-type** + **complexity** (each with confidence + the signals used) → **cheapest capable model** (clears the capability floor for that profile) with $ saving vs the trace's anchor model, and a one-line "here's why."

## Depends on
- `src/lib/parseTrace.ts` (built) — extended in C1 with behavioral signals.
- `src/lib/counterfactual.ts` (built) — recommendation reuses its cost projection.
- `src/lib/models.ts` (built) — `Model` gains per-domain capability scores in C3.

---

## Stories (dependency-ordered)

### C1 — Behavioral signals (extend `parseTrace.ts`)
Extend `ParsedRun` with a `signals` object (additive — existing fields untouched):
```ts
signals: {
  toolNames: Record<string, number>;   // tool_use name → count across runs
  totalToolCalls: number;
  turnCount: number;                    // assistant turns observed
  outputToInputRatio: number;          // avgOutputTokens / (avgInputTokens + caches)
  hasCodeBlocks: boolean;              // ``` fences in any output text block
  hasJsonOutput: boolean;             // output parses as / contains JSON object/array
  hasCitations: boolean;              // URL/citation markers in output
  reasoningTokenRatio: number;        // thinking/reasoning tokens ÷ output tokens (0 if none)
  repairSignals: number;              // retries/repairs detected (repeated tool errs, "try again")
};
```
Pure, additive. Anthropic JSON content blocks + Claude Code `.jsonl` content carry these. Where a signal is unavailable, default to 0/false (never throw).

### C2 — Task classifier (`src/lib/classifyTask.ts`)
```ts
export type TaskType = "coding" | "extraction" | "research" | "agentic" | "reasoning" | "chat";
export type Complexity = "low" | "med" | "high";
export type Classification = {
  taskType: TaskType; taskTypeConfidence: number;       // 0-1
  complexity: Complexity; complexityConfidence: number; // 0-1
  evidence: string[];   // human-readable signals that drove the verdict
};
export function classifyTask(p: ParsedRun): Classification
```
- **Transparent scoring**: each TaskType gets a score from weighted signal rules (documented in the spec); highest wins, confidence = margin-to-runner-up. Same for complexity (volume + loop depth + reasoning burn → low/med/high banded).
- `evidence` lists the firing signals ("8 file-edit tool calls", "code blocks in output", "5-turn loop").
- Deterministic, no thresholds pulled from thin air — every weight/threshold cited to the rule table in `SPEC-task-classifier.md`.

### C3 — Capability-floor matrix (data, research-grounded)
- Extend `Model` with per-domain capability scores from AA Intelligence Index domain breakdowns (e.g. `capability: { coding: number; reasoning: number; general: number }`, 0-100). Same sourcing discipline as `outputMultiplier` — cite source + confidence, no invented precision; unknown → conservative default + `low` confidence.
- A `CAPABILITY_FLOOR` table: `(TaskType × Complexity) → minimum required domain score`. Authored in the research phase, grounded in benchmark reasoning, with rationale per cell.

### C4 — Recommendation engine (`src/lib/recommend.ts`)
```ts
export type Recommendation = {
  current: Model;                  // anchor (trace model)
  recommended: Model | null;       // cheapest model clearing the floor; null if anchor already optimal
  monthlySaving: number;           // vs anchor at the parsed config
  rationale: string;               // "high-complexity coding → floor 78 coding; cheapest clearing = X"
  caveats: string[];               // confidence/override notes
};
export function recommend(p: ParsedRun, cls: Classification, config: AgentConfig): Recommendation
```
- Filter models to those clearing `CAPABILITY_FLOOR[type][complexity]` for the relevant domain → among those, pick cheapest **effective** monthly cost (reuse `projectCounterfactual`, `applyMultiplier: true`). If the anchor is already the cheapest-capable → `recommended: null` ("already optimal").

### C5 — UI: "Task DNA" card (`src/app/page.tsx`, additive)
- Rendered after a trace parse: detected type + complexity (each with a confidence bar + the `evidence` chips), then the recommendation line ("Cheapest capable: **X** — save **$Y/mo**. Why: …").
- **Override controls**: user can change task-type/complexity (re-runs `recommend`); honesty caveat shown ("classified from your trace's behavior — adjust if it's off").
- Keep stone-palette styling; never crash on missing signals.

### C6 — Tests (`src/lib/__tests__/`)
- `classifyTask` cases: one fixture per TaskType with the expected verdict + evidence (coding trace, extraction trace, research trace, agentic loop, chat).
- `recommend` cases: floor enforcement (a cheap-but-incapable model is NOT recommended), anchor-already-optimal → null, saving math.
- Extend `parseTrace` signal-extraction tests.

---

## Out of scope
- Any trained/embedded ML model, backend, API key, affiliate/referral links (explicitly dropped).
- Non-Anthropic/Claude-Code trace formats.

## Definition of done (workflow)
- `npm run build` clean, `npm test` green; Task DNA card works end-to-end on a sample trace; classifier shows evidence + confidence + override; recommendation respects the capability floor.
- Diff additive + **uncommitted**. Human gate: sanity-check classifications on a few of your own real traces before public push (pairs with the counterfactual ship-gate).
