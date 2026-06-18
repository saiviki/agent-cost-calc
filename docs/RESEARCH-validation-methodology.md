# RESEARCH — Validation Methodology for Cross-Model Cost Counterfactuals

> Written: 2026-06-18
> Source: operator validation deep-dive (web-cited; primary docs 2026-06-18)
> Status: Requirements + methodology — drives the next iteration toward a defensible ±5% cross-model counterfactual
> Companion gap analysis: docs/AUDIT-counterfactual-vs-validation-spec.md

---

## 1. Thesis

Naive `tokens × price` fails the ±5% target on real traces because provider billing is **not** "your token count × list price." It is the provider's tokenizer applied to its **full serialized request** (including hidden system prompts, tool schemas, and formatting) **plus** cache tier splits **plus** reasoning tokens **plus** the batch flag **plus** any server-tool fees. Cross-model projection makes the error worse, because every one of those terms changes when you swap the model.

The consequence: a counterfactual cost engine that does not re-derive each term from captured ground-truth metadata will routinely drift 10–50%+ on agent traces, regardless of how accurate the per-token list prices are. This document specifies the minimum trace metadata, the ordered correction sequence, and the validation protocol required to make a ±5% cross-model counterfactual defensible.

---

## 2. Required trace metadata (minimum to hit ±5%)

Every captured API call must carry the fields below. Without all of the mandatory fields, drift on non-trivial agent traces easily exceeds 10–20% (see §6).

| Field | Requirement | Definition |
|---|---|---|
| `raw_request` | **Mandatory** | The full API payload as sent — `messages`, `system`, `tools`, `cache_control` (or the provider equivalent) — or a structured equivalent from which it can be faithfully reconstructed. This is the only way to recover hidden/system/tool tokens. |
| `raw_usage` | **Mandatory** | The exact `response.usage` object returned by the provider, unparsed. The **only** reliable source of billed token counts (see §3.3). |
| `full_text_content` | **Mandatory** | The prompt text(s) **and** the completion text for each call, captured separately. Required to re-tokenize with a target model's tokenizer (see §3.1, §4 Phase 2). |
| `call_flags` | **Mandatory** | `model` + `version`, `is_batch` (or the endpoint used), `timestamp`, multimodal asset references, and the cache parameters actually used on the call. |
| `request_id` | Optional, high-value | Provider request ID — enables cross-check against dashboard line items. |
| `org effective rates` | Optional, high-value | Account-level effective rates, if exposed by the provider; otherwise list prices are used and volume discounts are reported as a band (see §3.4). |

### 2.1 Exact `raw_usage` fields per provider

The billed-token fields that must be captured differ by provider. Capture the **entire** `usage` object; the named fields below are the ones the corrections depend on.

- **Anthropic** — `input_tokens` + `cache_creation_input_tokens` + `cache_read_input_tokens` + `output_tokens`
- **OpenAI** — `prompt_tokens` + `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens`
- **Gemini** — `usage_metadata` (with `cached_content_token_count`)

---

## 3. Per-error corrections (apply IN THIS ORDER)

The four corrections below are applied in sequence. Each lists the **naive error magnitude** (what you get if you skip it), the **correction**, and the **metadata it needs**.

### 3.1 (1) Tokenizer differences

- **Naive error**: 10–50%+ drift across tokenizer families. OpenAI families are the most efficient; Claude/Gemini are higher on code, JSON, and structured content. Within a single family the drift is ≤10%.
- **Correction**: **RE-TOKENIZE** the captured `full_text_content` (prompt text **and** completion text) with the **target model's OFFICIAL tokenizer** — `tiktoken` for OpenAI, the Anthropic tokenizer, or the Gemini SentencePiece-equivalent (or `litellm`'s unified tokenizer). Use those counts × the target's list prices. **Never reuse the source model's token counts.**
- **Metadata needed**: `full_text_content`. Without it, fallback adjustment factors fail ±5% on mixed content.

### 3.2 (2) Prompt caching tiers

- **Naive error**: 50–90% over/under on cached portions of a request.
- **Provider rates (exact)**:
  - **Anthropic** — cache **reads** = `0.1×` base input; cache **writes** = `1.25×` (5-minute TTL) or `2×` (1-hour TTL).
  - **OpenAI** — cached tokens are often `0.5×` or `0.1×` on recent flagships.
  - **Gemini** — implicit caching ~`0.1–0.25×`.
- **Cache state is per-request** and is reported inside `raw_usage` (the splits named in §2.1).
- **Correction**: Parse the `raw_usage` splits and compute the original-model cost with the correct cache rates. For the **target** model, **default to FULL list price (no cache)** unless (a) it is same-family, (b) cache metadata is present, and (c) prefix context lets you model a hit probability — in which case expose a toggle `assume X% cache hit rate`. **NEVER infer cache hits from text alone.**
- **Metadata needed**: `raw_usage` (cache splits) + `call_flags` (cache params used).

### 3.3 (3) Hidden tokens (system, tools, reasoning, formatting, multimodal)

- **Naive error**: framework/naive token counts miss 10–30%+ of billed tokens. Tool schemas alone add 1k–10k+ tokens; providers inject system content; `reasoning_tokens` are billed but are sometimes absent from the visible output; image token formulas are model-specific.
- **Correction**: Treat the provider's `raw_usage` as **GROUND TRUTH** for cost on the original model. For the counterfactual, re-tokenize the **captured TEXT parts only** and accept a residual ~5–15% from tool-JSON-schema diffs + provider formatting. **Flag multimodal/reasoning traces as higher risk.** **Do not use framework token estimators.**
- **Metadata needed**: `raw_usage` (ground truth) + `raw_request` (to identify tool/system/multimodal presence). **This is the highest blast-radius item: without `raw_usage`, >10% drift is common on agent traces.**

### 3.4 (4) Batch vs real-time + volume tiers

- **Naive error**: **exactly 2×** on batch workloads — both OpenAI and Anthropic apply 50% off (input + output) for async Batch as of 2026, and this can **stack with cache** in some cases. Volume / committed-use discounts are account-level and opaque per-trace.
- **Correction**: Record the `is_batch` flag and apply the batch list price when set **and** the target supports an equivalent. For volume discounts, use list prices only and emit the line: `"list price; your actual effective rate may be N% lower (requires invoice data)"`. **Do not guess tiers.**
- **Metadata needed**: `call_flags.is_batch`; invoice data for volume (out of scope per-trace).

---

## 4. Validation methodology (to prove ±5% on ≥3 real traces)

### 4.1 Trace selection

Run on **3–5 diverse production-style traces**: a multi-turn agent with tools, **≥1 trace with caching**, **≥1 reasoning model**, and a mix of text/code/structured content. Capture everything in §2.

### 4.2 Phase 1 — reconstruction (must pass first)

For each call on model A, compute `cost_A'` from `raw_usage` + correct prices/cache/batch rules, and compare it to the **actual billed** amount (dashboard line item or `request_id` lookup, using the prices known to be in effect at trace time).

- **Target**: `<1–2%` error.
- **Failure meaning**: metadata or price table is wrong — stop and fix before proceeding.

### 4.3 Phase 2 — cross-model tokenization

Re-tokenize the captured prompt text with the **target model B's tokenizer** and compare to a real call to B's `usage.prompt_tokens` on the same prompt text; do the same for output using the captured completion text. Measure the % diff.

- **Within-family**: `<5%` diff expected.
- **Cross-family**: document the diff **per content type** (prose / code / JSON / structured).

### 4.4 Phase 3 — end-to-end counterfactual

Replay the captured prompt text (lightly adapted for the target API format; same tools where possible) on model B real-time (or batch if the trace is flagged). Capture B's `raw_usage`, compute the **actual** `cost_B`, then compute the **counterfactual** `cost_B'` using the corrections in §3 (re-tokenized counts + B prices, **no-cache default**). Measure `|cost_B' − cost_B| / cost_B`.

- **Sample size**: **≥20 calls per trace pair.**
- **Acceptance gate**: **ACCEPT if median ≤ 5% and P95 ≤ 8–10%.** (Output-token variance is real; isolate the input component if needed.)

### 4.5 Phase 4 — edge coverage

Explicitly test cache-hit traces, batch traces, heavy-tool traces, and multimodal traces (if in scope). Document the residual error sources for each.

### 4.6 Hard rule

> **If Phase 1 fails or `raw_*` not captured, do not claim ±5%.**

### 4.7 Tooling & feasibility notes

- Use **official tokenizers** or battle-tested wrappers (`tiktoken`, the Anthropic SDK tokenizer).
- **Snapshot price tables with dates** — prices drift; the validation is only valid against the dated price table in force at trace time.
- The ±5% target is achievable for **text-heavy traces with full capture**. Agent traces with dynamic tools / images / reasoning need **explicit error bands or per-component tolerances** rather than a single global ±5%.

---

## 5. Evidence

All items below were web-cited during the 2026-06-18 deep-dive; primary docs were crawled 2026-06-18 unless noted.

### 5.1 Pricing / cache

- **Anthropic** — cache writes `1.25×` (5m) / `2×` (1h) + cache reads `0.1×` base input; usage splits are authoritative and are the only reliable per-call source (Anthropic docs crawled 2026-06-18; corroborated by multiple 2026 analyses).
- **OpenAI** — automatic caching surfaced via `prompt_tokens_details.cached_tokens`; `reasoning_tokens` surfaced via `completion_tokens_details`; cached tokens priced at `0.5×` or lower on 2026 flagships (openai.com/api/pricing, 2026-06-18).
- **Gemini** — implicit ~75–90% discount surfaced via `cached_content_token_count` (Google docs, 2025–2026).

### 5.2 Tokenization / hidden tokens

- Cross-family token-count variance of **10–50%+** is typical; OpenAI families are the most efficient. Worked examples: GPT ~19 tokens vs Gemini ~55 tokens on the same text; Claude ~12% more tokens-per-char than GPT on prose (arXiv 2026-06-03; HN threads 2024/2026; 2026 analysis).
- Hidden tokens routinely cause framework-vs-provider mismatches; **`raw_usage` is the only reliable source.**

### 5.3 Validation mechanic

- **Batch 50% off** confirmed for both OpenAI and Anthropic in 2026 (openai.com 2026-06-18; multiple sources). Anthropic batch **stacks with cache** per 2026 reports.
- End-to-end replay + `usage`-diff is the standard validation pattern. **No public ±5% cross-model counterfactual tool was found** → confirms the custom-capture requirement this document specifies.

### 5.4 Note on contradictions

No major contradictions exist on the core mechanics. The discount % on OpenAI cache varied by model/year in older posts; the latest pricing page was used. Anthropic batch stacking with cache is reported in 2026 sources.

---

## 6. Risks / gaps / confidence

- Without `raw_request` + `raw_usage` capture on **every call**, drift easily exceeds **10–20%** on any non-trivial agent trace (tools, cache, reasoning, multimodal).
- Cross-family **output** tokenization is always approximate; expect residual error even with full capture.
- **Volume discounts** and per-provider hidden fees (server tools, code execution) are opaque from a trace alone.
- **Multimodal / reasoning-heavy workloads** need wider bands than ±5%.
- **Price tables must be versioned by date** — a dated price table is part of the artifact, not an external assumption.

**Confidence: 7/10.** The mechanisms and metadata requirements are solid and grounded in primary docs. The exact residual % on a real 3-trace validation requires **running** the protocol in §4 — which is **not done here**. Confidence rises to target only after Phases 1–3 pass on captured traces.

---

## 7. Relationship to current implementation

See **docs/AUDIT-counterfactual-vs-validation-spec.md** for the item-by-item status of these requirements against the uncommitted counterfactual implementation. As of this writing the implementation is Anthropic-only in its trace parser, uses a heuristic `outputMultiplier` (rather than re-tokenization), carries **no batch flag**, does **not** capture `raw_request`, and the ±5% acceptance gate exists only as an **unproven `it.todo`** on synthetic fixtures. That gap analysis maps each requirement in §2–§4 to the current code and flags what the next iteration must add to make the methodology above runnable.
