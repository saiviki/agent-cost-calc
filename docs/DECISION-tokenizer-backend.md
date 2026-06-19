# DECISION — API-backed tokenizer for Claude/Gemini targets (deferred)

> Written: 2026-06-19
> Status: DECISION — deferred (keep zero-backend); reopen on the evidence condition in §4.
> Scope: the Phase 2 tokenizer for Anthropic Claude 4.x and Google Gemini target models (`docs/SPEC-phase2-retokenization.md`). OpenAI targets are already exact client-side (`gpt-tokenizer`) and are unaffected.
> Context: surfaced as a residual after increment (d); operator declined to make the call, so it was decided on principle (P2/P3/P4/P7) and recorded here.
> Companion: `docs/SPEC-phase2-retokenization.md` §9 (the seam), `docs/RESEARCH-validation-methodology.md` §3.1 (correction #1), `docs/SPEC-phase3-replay.md` (the evidence gate).

---

This is a **decision record**, not a TODO. The deferral below is a deliberate, principled call, not something someone forgot to build. A future reader (human or agent) should be able to see *why* it was deferred and *what would change that*.

## 1. The decision

**KEEP the zero-backend stance. Do NOT build an API-backed tokenizer now.**

Claude 4.x and Gemini **target** models continue to return a clearly-flagged char-ratio approximation via `countTokens` in `src/lib/tokenize.ts`:

| Target | `method` | `family` | Ratio | Band |
| --- | --- | --- | --- | --- |
| OpenAI (GPT-5/o-series, GPT-4 era) | `exact` | `openai-o200k` / `openai-cl100k` | real `gpt-tokenizer` BPE | — |
| Anthropic Claude 4.x | `approx` | `anthropic-approx` | ~3.5 chars/tok | ±20–30% |
| Google Gemini | `approx` | `gemini-approx` | ~4.0 chars/tok | ±20–30% |

OpenAI targets are already exact client-side and are **unaffected** by this decision.

## 2. Why (principles)

- **P4 — evidence over trust.** The claim "the char-ratio approx is the binding ±5% error source for Claude/Gemini targets" is **unproven**: no real Phase 3 replay has been run (see §4). The harness exists and is proven on synthetic fixtures, but the empirical result requires a paid operator replay that has not happened. Do not build infrastructure on an unevaluated premise.
- **P3 — find the bottleneck.** The methodology's input-side gate already works, and OpenAI-target accuracy is exact client-side. The approx only matters for Claude/Gemini **cross-model** targets, and only *if* it is the dominant error term — which is exactly what a Phase 3 run would confirm or refute. Without that run, we do not know whether the approx is even on the critical path.
- **P2 — don't frictionlessly auto-resolve material consequences.** Adding a backend contradicts a **marketed feature**: the README states "Zero backend — all calculation runs client-side." That is a product-level commitment. It should not be overturned on speculation; it should be overturned on evidence, by a human, with eyes open.
- **P7 — optionality / no single-vendor lock-in.** Not-building is **strictly reversible**. A backend is a commitment — infrastructure, secrets in transit, a network dependency, a deploy surface, a CORS/origin story, a billing surface. Deferring keeps every option open and forces nothing.

## 3. The seam (where a backend would slot in, unchanged)

The single extension point is `countTokens(text, modelId, provider)` in `src/lib/tokenize.ts` — marked in source by the `EXTENSION POINT (P7)` comment and documented in `docs/SPEC-phase2-retokenization.md` §9.

A future API-backed tokenizer is a **localized** change:

1. Declare a new `TokenizerFamily` (e.g. `"anthropic-api"` / `"gemini-api"`).
2. Add one branch in `countTokens` for that family that returns `method: "exact"` (calling the provider's Count Tokens endpoint).
3. **No call-site edits.** `retokenize.ts`, `retokenizedCost.ts`, and `replayHarness.ts` all call `countTokens`, so they pick the new family up automatically.

This locality *is* the P7 guarantee: the decision to defer is cheap precisely because the cost of reopening is bounded to one module.

## 4. Reopen condition (evidence-gated)

Build the backend **only when all three hold**:

- **(a)** A real Phase 3 replay (`docs/SPEC-phase3-replay.md`; **≥20 calls** per trace pair) has been run for a Claude **or** Gemini **target** model, using the operator's own API key (the paid step that lives outside this zero-backend client).
- **(b)** The **input-side** `|counterfactual − actual| / actual` error for that target **exceeds the ±5% gate** (the primary gate, `gateBasis = "input"`; methodology §4.4).
- **(c) Root-cause isolation attributes the excess to the char-ratio approximation as the **binding** contributor** — having first ruled out, in the order given by `docs/RUNBOOK-billed-accuracy.md` §4:
  1. a wrong/drifted price table for the trace date;
  2. a cache-tier mis-rate (5m vs 1h write, cached-input discount);
  3. a field-name / usage-shape assumption (the target's real `usage` object vs what `reconstructCost` / `actualTokenCounts` reads).

Until (a)–(c) all hold, the approximation is **acceptable and honestly flagged**. Note the asymmetry: a single Phase 3 run that **passes** with the approx in place is **positive evidence not to build** — `method: "approx"` was good enough to meet the gate, so the backend would buy nothing.

The harness already surfaces the relevant warning: when `method = "approx"`, `evaluateReplay` warns that the input-side diff then reflects approx error, not pure tokenizer accuracy (`docs/SPEC-phase3-replay.md` §4) — i.e. the harness itself tells you when the approx is the thing under test.

## 5. Options considered (for the record)

| Option | Verdict |
| --- | --- |
| **(1) Defer; keep zero-backend; reopen on evidence** | **Chosen** (this decision). |
| **(2) Opt-in backend** (serverless function, env-gated; the client stays zero-backend by default) | **Rejected for now.** This is the *correct* design **if** evidence demands it, but it is premature without (a)–(c). Documented here as the prescribed path the moment the reopen condition fires. |
| **(3) Client-side with an operator-pasted key** (no server) | **Rejected.** Ships the API key into the browser — unsafe for the public Vercel deploy. At best a local-only convenience; not a general solution and not a posture the public app should take. |

## 6. What this does NOT change

No code changes result from this record. The honesty signals stay exactly as they are, because they remain **correct** under this decision:

- `method: "approx"` and the `anthropic-approx` / `gemini-approx` `family` values in `src/lib/tokenize.ts`;
- the `source` strings ("NO official client-side … tokenizer … ±20–30% band");
- the ±20–30% band surfaced in notes by `retokenize.ts` and `retokenizedCost.ts`;
- the `EXTENSION POINT (P7)` comment in `src/lib/tokenize.ts` and §9 of `docs/SPEC-phase2-retokenization.md`.

These are the user-visible signal that Claude/Gemini target counts are an approximation. Deferring the backend does **not** weaken them; it relies on them.
