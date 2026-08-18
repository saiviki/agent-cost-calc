# STATUS — Billed-Accuracy Gate (as of 2026-06-27)

> Living status of the empirical ±5% claim for the counterfactual engine.
> Companion to `docs/RUNBOOK-billed-accuracy.md` (the drop-in procedure) and
> `docs/RESEARCH-validation-methodology.md` §4 (the gate definition).

## TL;DR

| Layer | State | Claimed? |
|---|---|---|
| Engine + tests + validator plumbing | Done, green | (mechanism only) |
| Deterministic reconstruction (Phase 1 self-check) | 3/3 PASS, **0.00% err** | **NO** — circular |
| Billed accuracy vs real invoice $ | **Not measured** | **NO** — no real invoices wired |
| Cross-model replay (Phase 3, ≥20 calls) | Plumbing only (dry-run) | **NO** — no paid calls made |

**No empirical ±5% / P95 claim is made by this repo.** See `fixtures/README.md`
and `RUNBOOK-billed-accuracy.md` §1 for the honesty rule.

## The circularity you must know about

`fixtures/expected.json` currently sets `billedCostPerRun` = the engine's own
deterministic reconstruction (`expectedReconstructedCost / runs`) for the three
`real-*` traces. This is called out in the file's `_reconstructed_note`:

> billedCostPerRun values are the provider-equivalent deterministic bill: captured
> raw_usage × dated list prices (the same math the provider uses to produce the
> dashboard line item).

The validator (`npm run validate-counterfactual`) compares the engine's
reconstruction against this value and reports **0.00% error** — which proves the
arithmetic and cache-tier logic are internally consistent, **not** that the
engine matches a real invoice. The Phase 1 gate is therefore tautological until
`billedCostPerRun` is replaced with the operator's real per-run dashboard $.

The validator now prints `CIRCULAR_PLACEHOLDER` for these rows so the 0.00%
result cannot be mistaken for real invoice validation.

**This is intentional and documented** (`RUNBOOK-billed-accuracy.md` §1, §4).
The repo ships the drop-in mechanism; the operator owns the empirical claim.

## How to make the claim real (operator actions only)

1. **Replace `billedCostPerRun`** for ≥3 traces with real per-run dashboard $
   from each provider. Easiest path:
   ```bash
   npm run add-fixture -- <realTraceFile> <realPerRun$> [modelId]
   ```
   The script wires `expected.json`, copies the trace into `fixtures/`, prints
   the `it()` block, and runs `runBilledGate` for immediate feedback. It refuses
   to fabricate a bill — `<realPerRun$>` is an argument only the operator can
   supply.
2. **Diversify** per methodology §4.1: ≥1 multi-turn agent with tools, ≥1 with
   caching, ≥1 reasoning model, mix of text/code/structured.
3. **Run Phase 3 replay** (≥20 real PAID calls to a target model) for a
   cross-model claim: see `RUNBOOK-billed-accuracy.md` §5.
4. Flip the matching `it.todo` → real `it` in `parseTrace.test.ts`.

## Where real traces + invoices come from

See `docs/SOURCES-traces.md`.

## Verification log

- 2026-06-27: `npm run validate-counterfactual` exit 0 (3/3 Phase 1, Phase 2,
  Phase 2b all PASS at 0.00%). `npm test` 105 passed / 2 todo. Working tree
  clean, HEAD at `origin/main`. No empirical claim advanced — circularity
  documented here.

- 2026-07-03 Layer 1 verify-or-kill: `npx tsx scripts/validate-real-sessions.ts`
  priced 3 real Claude Code traces from `~/.claude/projects` and 3 Codex traces
  from `~/.codex/sessions`, but invoice reconciliation is parked:
  `summary rows=6 invoice_tested=0 blocked=6 failed=0`. Evidence:
  `docs/test-artifacts/real-session-validation.txt`. Do not commit/push/deploy
  until real Anthropic/OpenAI invoice totals are added via
  `fixtures/real-session-invoices.json` and all 6 rows pass within ±5%.
