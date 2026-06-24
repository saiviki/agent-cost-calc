# Cross-Model Cost Counterfactual — Design

> Generated: 2026-06-09

## Problem

Given a captured agent run trace (ordered list of LLM calls, each with model id, input tokens, output tokens, cached tokens, tool name), compute: "what would total cost have been on each of N alternative models, holding prompt structure fixed but applying each model's pricing and a per-model verbosity multiplier?"

---

## 1. Data Model

```typescript
// ── Trace ──────────────────────────────────────────────────────────────
interface Span {
  call_id:       string
  model_id:      string          // model actually used
  tool_name?:    string          // e.g. "code_executor", "retriever"
  input_tokens:  number          // total prompt tokens (includes cached portion)
  output_tokens: number          // completion tokens
  cached_tokens: number          // subset of input_tokens that were cache-hit
}

interface Trace {
  trace_id: string
  spans:    Span[]
}

// ── Pricing ────────────────────────────────────────────────────────────
interface ModelPricing {
  model_id:           string
  input_per_1m:       number   // $/1M non-cached input tokens
  output_per_1m:      number   // $/1M output tokens
  cache_read_per_1m:  number   // $/1M cached-hit input tokens (0 if no caching)
  cache_write_per_1m: number   // $/1M tokens written to cache
}

// ── Verbosity multiplier ───────────────────────────────────────────────
interface VerbosityMultiplier {
  model_id:   string
  v:          number  // 1.0 = identical output length; 1.3 = 30% more verbose
}

// ── Counterfactual result ──────────────────────────────────────────────
interface SpanCost {
  call_id:       string
  tool_name?:    string
  original_cost: number
  counterfactual_cost: number
}

interface CounterfactualResult {
  model_id:         string
  total_cost:       number
  delta_vs_original: number  // fraction; negative = more expensive, positive = cheaper
  verbosity_multiplier: number
  scaled_output_tokens: number  // total across all spans
  top_cost_driver:  string    // tool_name with highest Σ cost_span
  per_span_costs:   SpanCost[]
}
```

---

## 2. Counterfactual Formula

**Per-span cost for target model `m`:**

```
cost_span(i, m) =
    (input_i − cached_i) × P_input(m)    ← non-cached input
  + cached_i             × P_cache_read(m)
  + (output_i × V_m)     × P_output(m)   ← verbosity-scaled output
  all divided by 1_000_000
```

**Total trace cost:**
```
Cost(trace, m) = Σᵢ cost_span(i, m)
```

**Relative delta:**
```
Δ(m, baseline) = 1 − Cost(m) / Cost(baseline)
```
Positive Δ = cheaper than baseline; negative = more expensive.

**Notes on verbosity multiplier `V_m`:**
- `V_baseline = 1.0` (the model the trace was actually run on)
- Apply `V_m` only to `output_tokens`. Input tokens are held fixed.
- Optional cascade mode: if a more verbose model's output feeds as input to the next span, multiply that span's `input_tokens` by `V_prev`.

---

## 3. UI Surface

**Key display elements:**

```
Trace: checkout-agent-2026-06-09   spans: 34   original model: claude-opus-4

 Model                  Cost      vs original   Output (scaled)   Top cost driver
 ─────────────────────────────────────────────────────────────────────────────────
 claude-opus-4          $0.142    baseline       45,200 tok        retriever (38%)
 claude-sonnet-4        $0.041    −71%           45,200 tok        retriever (35%)
 claude-haiku-4         $0.011    −92%           52,480 tok  ×1.16 code_executor (41%)
 gpt-4o                 $0.063    −56%           49,720 tok  ×1.10 retriever (40%)
 gpt-4o-mini            $0.009    −94%           47,460 tok  ×1.05 code_executor (39%)
```

Design rules:
- Sort by cost ascending (cheapest first)
- Show `×V_m` only when `V_m ≠ 1.0`
- "Top cost driver" = tool_name with highest Σ cost_span
- Show secondary breakdown by tool_name × model for deep dives

---

## 4. Validation (±5% self-check)

```
computed = Cost(trace, original_model, V=1.0)
error = |computed − invoice| / invoice
assert error < 0.05
```

**If error ≥ 5%, check:**
| Source | Check |
|--------|-------|
| Cache-write costs not captured | Add `cached_tokens_written × P_cache_write` per span |
| Batch API discount | Apply 0.5× multiplier for async/batch endpoint |
| Token-count drift | Diff a few spans against raw response headers |
| Rounding | Model as `ceil(cost × 10⁶) / 10⁶` per span |
| Minimum charge floor | Check pricing page fine print |

---

## Quick-reference formula card

```
cost_span(i, m) = [(input_i − cached_i)·Pᵢₙ(m)
                 +  cached_i            ·Pᶜʳ(m)
                 + (output_i · V_m)     ·Pₒᵤₜ(m)] / 1e6

Cost(trace, m)  = Σᵢ cost_span(i, m)

Δ(m, ref)       = 1 − Cost(m) / Cost(ref)    (+ve = cheaper)

Self-check:     |Cost(trace, original, V=1.0) − invoice| / invoice < 0.05
```
