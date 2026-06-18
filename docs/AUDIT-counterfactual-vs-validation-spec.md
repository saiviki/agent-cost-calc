# AUDIT — Counterfactual Implementation vs Validation/Correction Deliverable

> **Written:** 2026-06-18
> **Scope:** Uncommitted trace → counterfactual + task-classifier implementation (`src/lib/parseTrace.ts`, `counterfactual.ts`, `classifyTask.ts`, `recommend.ts`, `models.ts`, `app/page.tsx`) + `fixtures/` + `docs/SPEC-*` / `BUILD-PLAN-*` / `RESEARCH-*`.
> **Method:** Read all impl + docs verbatim; independently re-ran `npm test` / `tsc --noEmit` / `npm run build`; grepped `src/` for tokenizer, batch, raw_usage, reasoning_tokens; inspected git state.
> **Compared against:** the incoming *validation/correction deliverable* (4 metadata requirements, 4 corrections, 4-phase validation methodology; hard rule: *raw_usage is the only ground truth; do not claim ±5% unless Phase 1 passes and raw_* is captured*).
> **Cross-link:** `docs/RESEARCH-validation-methodology.md` (the companion spec capture).
> **Role:** Review only. No source was modified. This is the only file created.

---

## 0. Verification (evidence over trust)

Re-derived independently — did **not** trust the prior trace agent's summary.

| Check | Command | Actual result | Prior claim | Match? |
|---|---|---|---|---|
| Unit tests | `npm run test` | **28 passed \| 2 todo (30)**, 3 files, exit 0 | "28 pass / 2 todo / 0 fail" | ✅ **CONFIRMED** |
| Types | `npx tsc --noEmit` | exit 0, no output | "tsc clean" | ✅ **CONFIRMED** |
| Build | `npm run build` | ✓ Compiled (Next 16.2.6 Turbopack), 2 static routes, exit 0 | "build clean" | ✅ **CONFIRMED** |
| Git uncommitted | `git status` / `git log` | 4 new src files **untracked** (`parseTrace`, `counterfactual`, `classifyTask`, `recommend` + `__tests__/` + `docs/` + `fixtures/`); `page.tsx` + `models.ts` + `package*.json` **Modified**; `git log -- <new src files>` = **empty (never committed)**; `git log --branches --not --remotes` = **empty (nothing pushed)** | "do NOT commit / push" | ✅ **CONSTRAINT HELD** |

**[V]** The two `it.todo` items are exactly the accuracy-gate assertions (`src/lib/__tests__/parseTrace.test.ts:276-281`) — i.e. the todo count *is* the deferred ±5% gate. No contradiction with the prior summary on numbers.

**Where the prior summary is silent / would mislead:** it reports green CI, but the green CI is green *because* the accuracy gate is `todo` and the parser is Anthropic-only. Neither fact is a failure of the build — both are load-bearing limitations for any ±5% claim (see §3).

---

## 1. Summary table — deliverable item → status

Legend: ✅ IMPLEMENTED · ◐ PARTIAL · ✗ MISSING · ⊘ OUT-OF-SCOPE-BY-DESIGN.

### (A) Required trace metadata

| # | Deliverable item | Status | Evidence (file:line) | Blast radius |
|---|---|---|---|---|
| A1 | `raw_request` (full API payload incl. system/tools/cache_control) | ✗ MISSING | `parseTrace.ts:145-180` (`extractRun` reads only the 4 `usage.*` fields + tool_use count) | **High.** Cannot reconstruct billed cost from scratch, cannot re-tokenize prompt, cannot validate cache_control TTL. Payload is discarded on parse. |
| A2 | `raw_usage` (exact provider usage object) | ◐ PARTIAL — **Anthropic only** | `parseTrace.ts:146-171`; OpenAI `prompt_tokens`/`cached_tokens`/`reasoning_tokens` and Gemini `usage_metadata` never read (confirmed: `rg src` for those tokens = empty) | **High.** Any non-Anthropic trace is unparseable. The deliverable's multi-provider ground-truth model is unreachable. (Design gap, see §4.) |
| A3 | `full_text_content` (prompt + completion text per call, for re-tokenization) | ✗ MISSING | `parseTrace.ts:206-272` (`accumulateSignals` scans text only for boolean signals + a thinking-char *ratio*; raw text not retained) | **Critical.** Phase 2 (re-tokenization) is impossible without it. Text is reduced to flags at parse time. |
| A4 | `call_flags` — model+version | ✅ model captured; version ❌ | `parseTrace.ts:185-187` (`sourceModel` = first `message.model`); no version/endpoint field | Med. Date-suffixed IDs are fuzzy-matched, not versioned. |
| A4b | `call_flags` — `is_batch` | ✗ MISSING | `rg src` for `is_batch|batch` = **empty** | **High.** Correction #4 entirely unaddressed. |
| A4c | `call_flags` — timestamp | ✗ MISSING | not parsed anywhere | Med. No temporal ordering / dedup possible. |
| A4d | `call_flags` — multimodal refs | ✗ MISSING | `parseTrace.ts:206-272` handles only `text`/`tool_use`/`thinking`/`redacted_thinking`; **image blocks ignored** | Med. Multimodal traces undercounted. |
| A4e | `call_flags` — cache params (cache_control TTL etc.) | ✗ MISSING | only cache *token counts* captured, not cache_control structure | Med. 5m vs 1h tier indistinguishable downstream. |
| A5 | `request_id` (optional) | ✗ MISSING | `rg src` = empty | Low (optional). |
| A6 | org effective rates (optional) | ⊘ OUT-OF-SCOPE | no rate-override surface anywhere | Low (optional). |

### (B) The 4 corrections

| # | Correction | Status | Evidence | Blast radius |
|---|---|---|---|---|
| B1 | **Tokenizer differences** — re-tokenize with target model's official tokenizer | ✗ MISSING — a **heuristic multiplier** is used instead | `models.ts:49-53` (`outputMultiplier`), `RESEARCH-consumption-multipliers.md` ("Methodology": ratio of AA Intelligence Index raw token counts, baseline Claude Sonnet 4.6 = 14M). No `tiktoken` / `@anthropic-ai/tokenizer` / `gpt-tokenizer` in `package.json` deps; `rg src` for tokenizer = **empty** | **CRITICAL — the central finding (§3).** |
| B2 | **Prompt caching tiers** (Anthropic read 0.1×, write_5m 1.25×, write_1h 2×; OpenAI cached 0.5×/0.1×; Gemini implicit) | ◐ PARTIAL — Anthropic 5m correct; 1h/OpenAI-cached/Gemini-implicit not modeled | `counterfactual.ts:82-118` uses `cacheReadPricePerM` (0.1×) + `cacheWritePricePerM` (1.25×) correctly. **Only one write tier** exists in `Model` (`models.ts` single `cacheWritePricePerM`) — 1h (2×) absent. Per-request cache *is* read from usage at parse (`parseTrace.ts:163-171`) **but collapsed to a single scalar** `config.cacheHitRate` by `parsedRunToConfig` (`parseTrace.ts:473`) — downstream cost recomputes from a uniform rate, not per-request. OpenAI `cached_tokens` never parsed. | High. Tier-2/3 providers + Anthropic 1h mispriced; per-request cache distribution lost at the config boundary. |
| B3 | **Hidden tokens** (system/tools/reasoning/formatting/multimodal) — treat raw_usage as ground truth | ◐ PARTIAL | Provider `usage.*` treated as ground truth for billing ✓; tool-call tokens modeled as input with **no multiplier** ✓ (SPEC OQ-4 honored, `models.ts` `calculateCost` `toolCallCost` uses `(input+output)/2`). **But** `tokensPerToolCall` is a hardcoded `200` with no signal (`parseTrace.ts:465`), and **OpenAI `reasoning_tokens` not captured** (`rg src` empty; parser Anthropic-only) | Med. For Anthropic traces the contract holds; hidden-token correctness is unverifiable for OpenAI because such traces can't be ingested. |
| B4 | **Batch vs real-time + volume tiers** | ✗ MISSING | `rg src` for `batch` = **empty**; all prices are real-time list | High. Batch (50% off) + volume discount entirely absent. |

### (C) The 4-phase validation methodology

| # | Phase | Status | Evidence | Blast radius |
|---|---|---|---|---|
| C1 | **Phase 1 — reconstruction** (cost_A' from raw_usage + prices/cache/batch vs actual billed; target <1-2%) | ✗ MISSING | No reconstruction harness. The only "accuracy" surface is `parseTrace.test.ts:276-281` (2× `it.todo`) on **synthetic** fixtures whose `expected.json` `billedCostPerRun` is `null` (`fixtures/expected.json`, `fixtures/README.md`) | **Critical.** Without Phase 1, no accuracy claim is defensible. |
| C2 | **Phase 2 — cross-model tokenization** (re-tokenize prompt+completion with target tokenizer) | ✗ MISSING | No re-tokenization code; no tokenizer dependency (B1) | Critical. The *cross-model* in counterfactual rests entirely on the B1 multiplier. |
| C3 | **Phase 3 — end-to-end counterfactual replay** (≥20 calls, median ≤5% / P95 ≤8-10%) | ✗ MISSING | `projectCounterfactual` (`counterfactual.ts:14-64`) is a **static projection** (config × multiplier × prices), not a replay. No replay harness, no ≥20-call dataset | Critical. No empirical accuracy evidence exists. |
| C4 | **Phase 4 — edge coverage** (cache-hit-heavy, batch, heavy-tool, multimodal) | ✗ MISSING | `fixtures/` = 2 synthetic Anthropic-only traces (`claude-code-session.jsonl`, `droid-run.json`), both hand-built, no billed cost | High. No edge-case validation possible. |

---

## 2. Accuracy-gate state (characterized)

- **Gate location:** `src/lib/__tests__/parseTrace.test.ts:276-281` — two `it.todo(...)` assertions (claude-code-session, droid-run).
- **Gate target:** ±2% (target) / ±5% (hard) vs `fixtures/expected.json` (`fixtures/README.md` "Gate").
- **Why it's todo:** `fixtures/expected.json` `billedCostPerRun` is `null` for both fixtures; fixtures are explicitly **synthetic** (`fixtures/README.md` "What's here now (SYNTHETIC)").
- **Fixtures content [V]:**
  - `claude-code-session.jsonl` — 2 assistant turns (model `claude-sonnet-4-6`), cache-heavy (8k/9k read), 3 tool_use, 1 `result` turn (correctly skipped).
  - `droid-run.json` — 2-element Anthropic-array, model `glm-5.1`, cache-heavy.
  - Both are structurally realistic but carry **no real invoice cost**.
- **Net:** the gate is **inactive**. CI is green by design (todo), not by passing an accuracy check.

---

## 3. Central finding — heuristic multiplier vs real tokenizer (LOAD-BEARING RISK)

> The deliverable's core thesis is: *raw_usage is the only ground truth; framework/heuristic token estimators cause >10% drift.* The project's only cross-model adjustment mechanism is `outputMultiplier` — a **heuristic verbosity ratio**, not a tokenizer. This is the single largest gap between the implementation and a defensible ±5% claim.

**What `outputMultiplier` actually is [V]:**
- A per-model scalar = `model_raw_tokens / 14M` where both numerator and denominator are **Artificial Analysis Intelligence Index v4.0 benchmark-suite output-token totals** (`RESEARCH-consumption-multipliers.md` "Methodology"; `models.ts:54` `AA_SOURCE`).
- It is applied as `effectiveOutputTokens = config.outputTokensPerRun * model.outputMultiplier` (`models.ts` `calculateCost`, `SPEC-effective-cost.md §2.2`).
- It is **not** a tokenizer, not per-request, and not derived from the user's actual prompt/completion text.

**Why it cannot carry a ±5% cross-model claim [I, backed by the project's own research]:**
1. `RESEARCH-consumption-multipliers.md` Caveat #1 (verbatim): *"Real agent workloads may shift these ratios ±20-30%."* The project's own source documents a 20-30% workload-shift band — an order of magnitude wider than the ±5% target.
2. The multiplier **conflates two effects the deliverable separates** — (a) tokenizer difference (how a model segments the *same* text) and (b) verbosity (how many tokens a model *chooses* to emit). A benchmark-suite ratio cannot disentangle these for a specific request.
3. No Phase-2 re-tokenization exists (C2), so there is no mechanism to correct tokenizer drift on real inputs; the multiplier is the *entire* cross-model bridge.
4. For the **anchor** model the multiplier is applied to the anchor's *own observed* output, which for non-1.0 anchors (e.g. `glm-5.1` = 1.0 placeholder, `deepseek-v4-flash` = 17.1) means the reconstructed anchor cost is already a heuristic estimate, not a measurement.

**Residual-risk statement:** Until a real tokenizer (Phase 2) is wired and Phase 1 reconstruction passes on real billed fixtures, any "±5%" figure attributed to this tool is **unsupported**. The deliverable's hard rule (*"If Phase 1 fails or raw_* not captured, do not claim ±5%"*) is currently **triggered**: Phase 1 has no real fixtures, and `raw_request`/`full_text_content` are not captured (A1, A3).

---

## 4. Designed gaps vs implementation gaps vs claim-vs-reality drift

### 4a. DESIGNED gaps — out of scope per `BUILD-PLAN` (NOT bugs; do not "fix" without re-scoping)
- **Non-Anthropic trace formats (OpenAI/Gemini)** — explicitly excluded: `BUILD-PLAN-trace-counterfactual.md` "Out of scope"; `SPEC-trace-parser.md §10`. → *This is why A2/B3 are partial, not bugs.*
- **Real billed-cost fixtures** — explicitly deferred to the operator: `BUILD-PLAN S5`, `fixtures/README.md`. → *Why C1 is todo, not a bug.*
- **Backend / accounts / shareable URLs** — out of scope.
- **Trained/embedded ML classifier** — out of scope (heuristic by design, `BUILD-PLAN-task-classifier.md`).
- **Single cache-write tier (5m only)** — the `Model` type has one `cacheWritePricePerM`; 1h (2×) is a known simplification no spec required. (Flags as B2 partial, but designed.)

### 4b. IMPLEMENTATION gaps — bugs / missing logic vs the project's *own* spec
- **None material.** The implementation faithfully realizes what `SPEC-trace-parser.md`, `SPEC-effective-cost.md`, `SPEC-recommend.md`, and `SPEC-task-classifier.md` specify: two-pass detection, exact rounding rules, the `applyMultiplier` additive contract, the Step-6.5 non-negative-saving guard, the capability-floor empty guard, signal extraction. `vitest 28/2` + clean `tsc` + clean `build` confirm the contract holds.
- Minor observations (non-blocking, no behavioral bug):
  - `parsedRunToConfig` collapses per-request cache into one scalar (`parseTrace.ts:473`) — this **is** what SPEC §4 prescribes, so it is *spec-correct* but it is the precise seam where deliverable correction B2's "per-request" requirement is lost.
  - `tokensPerToolCall = 200` hardcoded (`parseTrace.ts:465`) — spec-mandated default; flagged in `warnings`. Not a bug, but it is an unevidenced constant feeding the cost model.

### 4c. CLAIM-VS-REALITY drift — where the project's framing outruns what it can substantiate
1. **"±5% accuracy" ship-gate language** (`fixtures/README.md` "Gate", `BUILD-PLAN` Definition-of-done human gate) implies a near-term, demonstrable accuracy bound. Nothing in the project can substantiate ±5%: the gate is `it.todo`, Phase 1-4 are absent, and the cost bridge is a heuristic with a self-documented ±20-30% band. **Drift: stated gate ≠ demonstrable accuracy.**
2. **"Effective cost (normalize by verbosity)" hero framing** (`page.tsx:557-559`, `BUILD-PLAN` Hero feature) presents multiplier-adjusted cost as a defensible cross-model projection. It is a *directional* projection, not a measured one — the multiplier is a fixed-benchmark ratio. **Drift: presentation precision > underlying evidence.**
3. **Anchor cost for non-baseline models.** When the trace's source model has `outputMultiplier ≠ 1.0` (e.g. DeepSeek, Kimi), the anchor row's "effective" cost is itself a heuristic, so the Δ% column is *heuristic-vs-heuristic*, not *measured-vs-projected*. The UI does not flag this. **Drift: the anchor is presented as ground truth but is itself estimated.**

---

## 5. Prioritized recommendations (ranked by blast radius)

> Ordered by how much each moves the project toward a *defensible* ±5% claim. Each is a build task for a build agent — **not applied here.**

1. **[P0] Capture `raw_usage` + `raw_request` + `full_text_content` per call (A1/A2/A3).** Without the ground-truth payload retained, Phases 1-2 are structurally impossible. Extend `ParsedRun` (additively) to carry a per-run `raw` array. — *Unblocks C1, C2, B1.*
2. **[P0] Build Phase 1 reconstruction harness + land ≥2 real billed fixtures.** Compute `cost_A'` from `raw_usage` + prices/cache/batch and compare to invoice. Flip the `it.todo` to real assertions. This is the deliverable's accuracy foundation — until it passes, no ±5% claim. — *Directly satisfies the hard rule.*
3. **[P1] Replace the heuristic multiplier with real re-tokenization (B1/C2).** Add a tokenizer (`tiktoken` for OpenAI; Anthropic/Gemini client-side approximations) and re-tokenize captured `full_text_content` per target model. Keep `outputMultiplier` only as a *verbosity* factor layered on top of — not in place of — tokenization. — *Removes the central finding.*
4. **[P1] Add `is_batch` + batch/volume pricing (B4).** Parse the batch flag from `raw_request`; apply 50%-off batch tier where present; add volume-discount tier hooks. — *Closes correction #4.*
5. **[P2] Preserve per-request cache state through to cost (B2).** Stop collapsing to a scalar at the config boundary; carry the per-run `cache_read`/`cache_creation_5m`/`cache_creation_1h` split into `calculateCost`. Add the Anthropic 1h (2×) tier. Model OpenAI cached (0.5×/0.1×) and Gemini implicit cache once OpenAI/Gemini ingestion lands. — *Closes correction #2.*
6. **[P2] Extend the parser to OpenAI + Gemini usage shapes (A2).** Parse `prompt_tokens`/`completion_tokens`/`prompt_tokens_details.cached_tokens`/`completion_tokens_details.reasoning_tokens` (OpenAI) and `usage_metadata` (Gemini). — *Removes the designed gap that currently hides B3 reasoning tokens.*
7. **[P2] Build Phase 3 replay harness (C3)** on ≥20 real calls; report median/P95 error. — *The empirical accuracy evidence.*
8. **[P3] Date-stamp the price table (Version note).** Add a structured `pricingAsOf: "2026-05-09"` field (or a `PRICE_SNAPSHOT` const) to `models.ts`; today it is prose-only (`models.ts:56` comment, `AA_SOURCE` 2026-05-30). — *Satisfies the deliverable's snapshot-by-date requirement.*
9. **[P3] Phase 4 edge fixtures (C4):** cache-hit-heavy, batch, heavy-tool, multimodal traces with real billed cost.
10. **[P3] Surface the heuristic-bridge caveat in the UI** at the counterfactual table (not just the multiplier tooltip) so the "effective cost" column is not read as a measured accuracy. — *Closes drift item #2/#3.*

---

## 6. Version note — price-table dating

- **Requirement (deliverable):** snapshot price tables by date.
- **Current state [V]:** `models.ts:56` carries a comment *"Pricing verified 2026-05-09 against OpenRouter's unified pricing API"*; `models.ts:54` `AA_SOURCE` = *"...confirmed 2026-05-30"*. **These are prose comments only — there is no structured/dated field on the `Model` type or a versioned `PRICE_SNAPSHOT` constant** (confirmed: `rg models.ts` for `pricingAsOf|asOf|effectiveDate|snapshot|version` → only comment matches).
- **Gap:** prices are not programmatically versioned. A price change would silently shift every projection with no diffable date stamp in the data. → Recommendation #8.

---

## 7. Bottom line

- **Build quality vs its own spec: CLEAN.** Tests/types/build green; the 4 modules faithfully implement the 4 SPECs; the two `it.todo` are the deliberately-deferred accuracy gate, not failures.
- **"Do NOT commit" constraint: HELD.** Nothing committed or pushed.
- **vs the validation deliverable: the implementation is at the *measurement* starting line, not the finish.** It correctly reads Anthropic `raw_usage` (the deliverable's ground truth) and applies correct Anthropic cache-read/write math — but it then bridges to other models via a **heuristic verbosity multiplier** (not a tokenizer), captures neither `raw_request` nor `full_text_content`, has **no Phase 1-4 validation harness**, and has **no real billed fixtures**. Per the deliverable's own hard rule, **the project cannot currently claim ±5%; it must not do so publicly until Phase 1 passes on real fixtures and a real tokenizer replaces/augments the multiplier.**

> This audit created `docs/AUDIT-counterfactual-vs-validation-spec.md` only. No source modified, nothing committed.
