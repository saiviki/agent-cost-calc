# Build Plan — Trace → Cross-Model Cost Counterfactual

> Turns Agent Cost Calc from a *guess-the-inputs calculator* into a *measure-from-a-real-trace profiler* that projects **effective** cost across all models.
> Constraints: **additive only**, **do NOT commit** (leave diff for human review), **do NOT push**. Next.js 15 + React 19 + Tailwind, zero backend, all client-side.

## Hero feature
Paste a real agent run → extract the *actual* per-run profile (incl. real measured cache hit rate) → project **effective** cost across all 16 models, applying a per-model **token-consumption multiplier** from benchmark data. The **cache-rate reveal** is the hero moment.

## Existing surface (do not break)
- `src/lib/models.ts` — `Model` type, `MODELS[]` (16), `AgentConfig`, `calculateCost(config, model)`, `formatCost`, `filterModels`.
- `src/app/page.tsx` — single client page (sliders for the config, sorted comparison table).
- No test framework yet → add **vitest** (`npm i -D vitest`), add `"test": "vitest run"` to package.json.

---

## Stories (dependency-ordered)

### S1 — Per-model consumption multiplier (data + math)
- Extend `Model` with:
  - `outputMultiplier: number` — effective output-tokens-per-task **relative to baseline** (baseline = Claude Sonnet 4.6 = `1.0`). Reasoning/verbose models > 1.0; terse models < 1.0. Default `1.0` when unknown.
  - `multiplierSource?: string`, `multiplierConfidence?: "high" | "med" | "low"`.
- Source values from `docs/RESEARCH-consumption-multipliers.md` (written by the Research phase). Use `1.0` + `confidence:"low"` for any model lacking data — never invent precision.
- Effective output tokens for model M = `config.outputTokensPerRun * M.outputMultiplier`.
- `calculateCost` gains an `options?: { applyMultiplier?: boolean }` (default `false` to preserve current behavior; counterfactual passes `true`).

### S2 — Trace parser (`src/lib/parseTrace.ts`)
- `parseTrace(raw: string): ParsedRun` — auto-detect + parse:
  - **Anthropic Messages API** response JSON (single object OR array): read `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`.
  - **Claude Code session `.jsonl`**: one JSON per line; sum/avg the `message.usage` blocks across assistant turns; count turns as runs.
- Return:
  ```ts
  type ParsedRun = {
    sourceModel?: string;          // best-effort from trace
    runs: number;                  // # of model calls observed
    avgInputTokens: number;        // incl. system, non-cached
    avgOutputTokens: number;
    avgCacheReadTokens: number;
    avgCacheCreationTokens: number;
    measuredCacheHitRate: number;  // cache_read / (cache_read + input + cache_creation)
    toolCallsPerRun: number;       // from tool_use blocks if present, else 0
    warnings: string[];            // unparsed lines, format guesses
  };
  ```
- `parsedRunToConfig(p: ParsedRun): AgentConfig` — map to the existing `AgentConfig` shape (this is what fills the sliders).
- Pure function, no DOM. Defensive: malformed input → throw a typed error with a helpful message; partial input → fill what's parseable + populate `warnings`.

### S3 — Counterfactual engine (`src/lib/counterfactual.ts`)
- `projectCounterfactual(config: AgentConfig, models?: Model[]): Projection[]`
  - For each model: compute **effective** monthly cost (`applyMultiplier: true`), sorted cheapest-first.
  - Anchor row = the trace's `sourceModel` (actual). Each row shows Δ% vs anchor.
  - Include `effectiveOutputTokens` and the multiplier used so the UI can show the math.
- `cacheRateInsight(config)` → `{ measured: number, atNinety: number, monthlySavingAtNinety: number }` for the hero reveal.

### S4 — UI: "Paste a real run" panel (`src/app/page.tsx`, additive)
- New collapsible panel above the sliders: a `<textarea>` + **"Profile this run"** button.
- On parse success:
  - Fill the existing config sliders from `parsedRunToConfig`.
  - Show a **cache-rate reveal banner**: "Your measured cache hit rate: **38%**. At 90% you'd save **$X/mo**."
  - Render the counterfactual table (anchor highlighted, Δ% column, effective-vs-nominal toggle).
- On parse failure: inline error + the `warnings`. Never crash the page.
- A toggle: **Effective cost (normalize by model verbosity)** ⇄ **Nominal cost**. Default = Effective. Tooltip cites the multiplier source + confidence.
- Keep current styling language (stone palette, mono numbers).

### S5 — Accuracy harness (`src/lib/__tests__/`, `fixtures/`)
- vitest. `parseTrace` unit tests (Anthropic JSON, Claude Code jsonl, malformed).
- **Accuracy fixtures**: `fixtures/claude-code-session.jsonl` + `fixtures/droid-run.json` + `fixtures/expected.json` (known invoice cost per fixture).
  - Ship with a **synthetic** fixture + a clear `fixtures/README.md` TODO: *operator drops in 1 real Claude Code session (from `~/.claude/projects/**/<id>.jsonl`) + 1 real Droid run, with the actual billed cost.*
- Gate test: parsed→computed cost within **±2% (target) / ±5% (hard gate)** of `expected.json`. Mark the real-fixture assertions `test.todo` until real fixtures land so CI stays green.

---

## Out of scope (do NOT build)
- Shareable scenario URLs, accounts/backend, pre-build "smart defaults", any non-Anthropic/Claude-Code trace format (v2).

## Definition of done (for this workflow)
- `npm run build` clean, `npm test` green (synthetic fixtures), page renders, paste→counterfactual works end-to-end on a sample Anthropic usage JSON.
- Diff is **additive + uncommitted**. Human gate before public push = real-fixture accuracy ≤±5% + dogfood writeup.
