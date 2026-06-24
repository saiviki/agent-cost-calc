# Task: Implement Cross-Model Cost Counterfactual Feature

## Context

This is a Next.js 15 + React 19 + Tailwind app for agent cost estimation. It already has:
- A 16-model pricing table in the existing app
- A forward-looking cost estimator (configure token counts → see cost per model)

Read `DESIGN-counterfactual.md` for the full schema and formula before starting.

## What to Build

Add a new **"Trace Analyzer"** tab/page alongside the existing cost estimator. This feature takes a real agent trace (past run) and computes what it would have cost on every model in the existing pricing table.

### Input

A JSON paste area accepting a trace in this shape:

```json
{
  "trace_id": "my-run-001",
  "spans": [
    {
      "call_id": "s1",
      "model_id": "claude-opus-4",
      "tool_name": "retriever",
      "input_tokens": 4200,
      "output_tokens": 890,
      "cached_tokens": 1800
    }
  ]
}
```

Also accept a simplified CSV format (one row per span):
```
call_id,model_id,tool_name,input_tokens,output_tokens,cached_tokens
s1,claude-opus-4,retriever,4200,890,1800
```

Provide a "Load example trace" button that fills in a realistic 8-span agent trace.

### Verbosity Multipliers

Use these defaults (user-editable via a small inline table in the UI):

| Model              | V     |
|--------------------|-------|
| claude-opus-*      | 1.00  |
| claude-sonnet-*    | 1.00  |
| claude-haiku-*     | 1.10  |
| gpt-5.5*           | 1.05  |
| gpt-5.4*           | 1.05  |
| gpt-5.4-mini       | 1.08  |
| gemini-3.1-pro     | 1.00  |
| gemini-3-flash     | 0.95  |
| deepseek-v4-pro    | 1.12  |
| deepseek-v4-flash  | 1.12  |
| kimi-k2.6          | 1.08  |
| glm-5.1            | 1.10  |
| qwen-3.6-plus      | 1.10  |
| llama-3.3-70b      | 1.15  |
| minimax-m2.7       | 1.08  |
| mistral-large-2    | 1.05  |

### Core Calculation

Implement `computeCounterfactual(trace, pricingTable, verbosityMap)` in `src/lib/counterfactual.ts`:

```typescript
// cost_span(i, m) = [(input_i - cached_i)*P_in(m) + cached_i*P_cr(m) + (output_i*V_m)*P_out(m)] / 1e6
// Cost(trace, m) = Σ cost_span(i, m)
// Δ(m, ref) = 1 - Cost(m) / Cost(ref)   (+ve = cheaper)
```

Reuse the existing model pricing data from the app — do not duplicate it. Find where the pricing table lives and import from it.

### Output Table

Render a results table sorted cheapest-first:

| Model | Cost | vs Original | Output (scaled) | Top cost driver |
|-------|------|-------------|-----------------|-----------------|
| DeepSeek V4 Flash | $0.008 | −94% | 52k tok ×1.12 | tool_a (41%) |
| ... | | | | |
| claude-opus-4 (original) | $0.142 | baseline | 45k tok | tool_b (38%) |

- Highlight the original model's row distinctly
- Show `×V_m` tag only when V ≠ 1.0
- "Top cost driver" = tool_name with highest Σ cost across all spans for that model
- Below the main table: a collapsible span-by-span breakdown for the selected model

### Validation Panel

Below the results, add a small "Invoice Validation" section:

- Input field: "Actual invoice amount ($)" 
- Computed value: Cost(original model, V=1.0)
- Shows: error % = |computed − actual| / actual × 100
- Green if < 5%, amber 5–15%, red > 15%
- If red, show the checklist from DESIGN-counterfactual.md §4

### Implementation Notes

1. All calculation is client-side (no backend) — consistent with the existing app
2. Reuse existing Tailwind classes and component patterns from the app
3. Add a tab switcher at the top: "Cost Estimator" | "Trace Analyzer"
4. The existing estimator functionality must remain unchanged
5. Put the new feature in `src/app/trace/page.tsx` (or as a tab component — match the existing routing pattern)
6. Unit test the core formula in `src/lib/counterfactual.test.ts` with at least 3 test cases:
   - Single span, no caching, V=1.0 → exact arithmetic check
   - Single span with cache hit, V=1.2 → verify cache read pricing applied
   - Multi-span trace → verify total = sum of spans

## Done Criteria

- [ ] Trace JSON and CSV input both parse correctly
- [ ] Example trace loads and computes
- [ ] Results table renders sorted cheapest-first with correct deltas
- [ ] Original model row highlighted
- [ ] Verbosity multipliers editable inline
- [ ] Invoice validation panel shows error %
- [ ] Span breakdown collapsible per model
- [ ] Existing estimator unchanged
- [ ] Formula unit tests pass (`npm test` or equivalent)
- [ ] `npm run build` succeeds with no type errors
