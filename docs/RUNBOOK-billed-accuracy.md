# RUNBOOK — Billed-Accuracy Gate (Phase 1 ±5%)

> Written: 2026-06-18
> Scope: how an operator validates the ±5% billed-accuracy claim with **real** data — the drop-in steps, what to capture per provider, and the honesty rule.
> Source: `docs/RESEARCH-validation-methodology.md` §4 (4-phase methodology), §4.1 (≥3 diverse real traces), §4.6 (hard rule).
> Companion: `docs/SPEC-phase1-reconstruction.md` (the reconstruction harness), `docs/SPEC-phase3-replay.md` (the deeper cross-model gate).

---

## 1. The claim — and its hard rule

> **If Phase 1 fails or `raw_*` not captured, do not claim ±5%.** — methodology §4.6

A **single** passing fixture is **necessary but NOT sufficient**. The methodology (§4.1)
requires **≥3 diverse real traces** before the ±5% claim is defensible:

- a **multi-turn agent with tools**,
- **≥1 trace with caching**,
- **≥1 reasoning model**,
- a **mix of text / code / structured** content.

Until those ≥3 real traces + real invoices are in this repo, **the ±5% claim is explicitly
NOT made.** The synthetic fixtures in `fixtures/` carry `billedCostPerRun: null`; every
billed gate in `parseTrace.test.ts` is `it.todo`. This repo ships only the **drop-in
mechanism** so the operator can flip the gate in ~5 minutes with their own real data.

The drop-in pieces this repo provides:

- **Helper** — `src/lib/__tests__/billedGate.helper.ts` (`runBilledGate`, `runAllBilledGates`).
- **Test scaffolds** — provider-general `it.todo` slots in `src/lib/__tests__/parseTrace.test.ts`.
- **Reconstruction** — `src/lib/reconstructCost.ts` (`passesPhase1`) is the underlying gate.

---

## 2. What you need to capture (per provider)

For **every** provider, also capture the **prices in effect at trace time** — prices drift,
and the validation is only valid against the dated price table (§4.7). Check/update
`src/lib/models.ts` to that date **before grading**.

### Anthropic

- **Trace**: a real Claude Code session (`~/.claude/projects/<project-hash>/<session-id>.jsonl`)
  **or** a real Messages API response (single object or array).
- **Billed cost**: look up the `request_id` in the Anthropic console usage/dashboard, **or**
  compute from the `usage` splits at the prices in effect at trace time.
- Record the **per-run billed $**.

### OpenAI

- **Trace**: a real Chat Completions response carrying the `usage` object —
  `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`,
  `completion_tokens_details.reasoning_tokens`.
  - Cached tokens are priced at the **cached rate**; `reasoning_tokens` are **already
    included** in `completion_tokens` (the harness surfaces them but does **not** add them again).
- **Billed cost**: OpenAI usage dashboard / billing API.
- Record the **per-run billed $**.

### Gemini

- **Trace**: a real `GenerateContent` response carrying `usage_metadata` —
  `prompt_token_count`, `candidates_token_count`, `cached_content_token_count`,
  `thoughts_token_count`.
  - `thoughts_token_count` is **separate** from `candidates_token_count` and is billed at
    the output rate (the harness **adds** it).
- **Billed cost**: Google AI Studio / Cloud billing.
- Record the **per-run billed $**.

> **Verify field names against the real trace.** The OpenAI/Gemini field names in this
> repo come from the research doc, **not** from a live API response you hold. When you drop
> in a real trace, confirm the usage object's actual shape matches what `parseTrace` /
> `reconstructCost.detectProvider` expect before grading.

---

## 3. Drop-in steps (~5 minutes)

### Shortcut: `npm run add-fixture`

`npm run add-fixture -- <traceFile> <billedPerRun> [modelId]` performs steps 1–2
and prints the exact `it()` block for step 3, then runs `runBilledGate` immediately
for instant feedback (the `billedPerRun` arg is **your real per-run invoice $** —
the script does NOT fabricate a bill). Add `--dry-run` to preview the would-be
`expected.json` patch + the `it()` block without writing; `--note "..."` is
optional. The manual steps below remain the explainer.

```bash
npm run add-fixture -- real-anthropic-agent.jsonl 0.0123 claude-sonnet-4-6
# preview only:
npm run add-fixture -- real-anthropic-agent.jsonl 0.0123 --dry-run
```

### Manual steps

1. **Save the real trace** to `fixtures/<name>`:
   - `fixtures/real-anthropic-agent.jsonl`
   - `fixtures/real-openai-run.json`
   - `fixtures/real-gemini-run.json`
2. **Add an entry** to `fixtures/expected.json`:
   ```json
   "<name>": {
     "expectedSourceModel": "<MODELS id, e.g. claude-sonnet-4-6>",
     "billedCostPerRun": <real per-run $, e.g. 0.0123>
   }
   ```
   `billedCostPerRun` is **per run** — the gate multiplies it by the run count observed
   in the trace to get the total billed.
3. **Flip** the matching `it.todo(...)` to a real `it(...)` in
   `src/lib/__tests__/parseTrace.test.ts`, calling the helper:
   ```ts
   import { runBilledGate } from "./billedGate.helper";

   it("<name> within ±5% of invoice", () => {
     const g = runBilledGate("<name>");
     expect(g.hasRealInvoice).toBe(true); // guards against a null bill
     expect(g.passesHard).toBe(true); // |computed - billed|/billed <= 5%
   });
   ```
4. **`npm run test`** — the gate runs against the real invoice. `passesHard` =
   `errorPct <= 5%` (target `<= 2%`).

---

## 4. Interpreting results

- **`passesHard: false` on a real invoice** ⇒ Phase 1 reconstruction is wrong for that
  provider. Per the methodology, **suspect in this order**:
  1. **Wrong price table for the trace date** (prices drifted; `models.ts` not dated to the trace).
  2. **A cache tier mis-rate** (5m vs 1h write; cached-input discount).
  3. **A field-name / usage-shape assumption** — verify the real trace's actual `usage`
     object against what `reconstructCost` reads.
- **Do NOT adjust the gate to pass. Fix the model.** The gate is a measurement, not a knob.
- The **deterministic reconstruction** (`expectedReconstructedCost` in `expected.json`,
  already a real `it()`) is a **separate** check: it proves the **arithmetic** from
  synthetic `raw_usage` + dated prices — **not** the billed accuracy.

---

## 5. Phase 3 — the deeper gate (for a full cross-model ±5% claim)

Phase 1 only validates **same-model reconstruction** (re-derive the billed cost of the
calls actually made). For a full **cross-model** ±5% claim, also run the **replay harness**
(`docs/SPEC-phase3-replay.md`):

1. `buildReplayPlan` against a **target model B** from the captured `rawCalls`.
2. **Replay ≥20 real calls** to B with your API key (operator step — outside this zero-backend client).
3. Feed B's **actual `raw_usage`** into `evaluateReplay`.
4. Check `passesPhase3`: **median ≤ 5%, P95 ≤ 8–10%** (§4.4).

This is **outside** the zero-backend client (it needs live API calls + keys). Without
Phase 3, only Phase 1 same-model reconstruction is validated.

---

## 6. What this repo will NOT do

- It will **not fabricate invoices** or invent billed costs.
- It will **not call provider billing APIs** (no backend, no keys).
- It will **not auto-claim ±5%.**

**The operator owns the empirical claim.** This repo owns the mechanism
(parser → reconstruction → gate helper → test scaffolds) and the honesty rule that the
claim is off the table until ≥3 real traces + real invoices land.
