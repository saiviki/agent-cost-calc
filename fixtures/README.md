# Accuracy Fixtures

Fixtures for the S5 accuracy harness (`src/lib/__tests__/parseTrace.test.ts`).

## What's here now (SYNTHETIC)

| File | Format | Status |
|---|---|---|
| `claude-code-session.jsonl` | Claude Code session `.jsonl` | **synthetic** — hand-built, parses cleanly (2 assistant turns, 1 result skipped) |
| `droid-run.json` | Anthropic Messages API array | **synthetic** — hand-built (2 runs) |
| `expected.json` | Expected metadata + (placeholder) billed cost | **synthetic** — `billedCostPerRun` is `null` |

These exist so `parseTrace` has structurally-realistic inputs to run against. They do **not** carry a real invoice cost, so the parsed→computed cost accuracy assertions are marked `it.todo(...)` and stay green in CI.

## TODO — operator drops in REAL fixtures

To activate the accuracy gate, the operator must:

1. **Claude Code session**: copy one real session from
   `~/.claude/projects/<project-hash>/<session-id>.jsonl` into
   `fixtures/claude-code-session.jsonl` (overwrite the synthetic one).
2. **Droid run**: capture one real Droid/Anthropic Messages API run (the response
   JSON, single object or array) into `fixtures/droid-run.json`.
3. **Billed cost**: record the *actual billed cost* for each from the provider
   dashboard / invoice into `expected.json` `billedCostPerRun` (replace the `null`s).
4. Flip the `it.todo(...)` assertions in `parseTrace.test.ts` to real `it(...)`
   tests that assert parsed→computed cost is within **±2% (target) / ±5% (hard
   gate)** of `expected.json`.

## Gate

- Target accuracy: **±2%** of billed cost.
- Hard gate (must pass before public push): **±5%**.
- Until real fixtures land, the accuracy assertions are `test.todo` so CI stays green.
