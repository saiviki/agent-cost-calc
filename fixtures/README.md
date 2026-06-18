# Accuracy Fixtures

Fixtures for the S5 accuracy harness (`src/lib/__tests__/parseTrace.test.ts`) and the
operator-facing billed-accuracy gate helper (`src/lib/__tests__/billedGate.helper.ts`).

## What's here now (SYNTHETIC)

| File | Format | Status |
|---|---|---|
| `claude-code-session.jsonl` | Claude Code session `.jsonl` | **synthetic** — hand-built, parses cleanly (2 assistant turns, 1 result skipped) |
| `droid-run.json` | Anthropic Messages API array | **synthetic** — hand-built (2 runs, attributed to `glm-5.1`) |
| `expected.json` | Expected metadata + (placeholder) billed cost | **synthetic** — `billedCostPerRun` is `null` for every fixture |

These exist so `parseTrace` has structurally-realistic inputs to run against. They carry
**no real invoice cost**, so the billed-accuracy assertions are `it.todo(...)` and stay
green in CI. (`billedCostPerRun` is **per run** — the gate multiplies it by the run count.)

## Real-trace slots supported (Anthropic / OpenAI / Gemini)

The gate helper is **provider-general**. The operator can drop in real traces for any of
the three providers; the matching `it.todo` scaffolds already exist in `parseTrace.test.ts`:

| Provider | Suggested name | Usage shape the helper reads |
|---|---|---|
| Anthropic | `real-anthropic-agent.jsonl` | `usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` |
| OpenAI | `real-openai-run.json` | `usage.prompt_tokens` + `prompt_tokens_details.cached_tokens` + `completion_tokens_details.reasoning_tokens` |
| Gemini | `real-gemini-run.json` | `usage_metadata.prompt_token_count` / `candidates_token_count` / `cached_content_token_count` / `thoughts_token_count` |

## TODO — operator drops in REAL fixtures

To activate the billed-accuracy gate, follow **`docs/RUNBOOK-billed-accuracy.md`** (~5 min):

1. **Save a real trace** to `fixtures/<name>` for the provider(s) you are validating
   (Anthropic / OpenAI / Gemini — see the table above).
2. **Record the actual per-run billed $** for each from the provider dashboard / invoice
   into `expected.json` `billedCostPerRun` (replace the `null`).
3. **Flip** the matching `it.todo(...)` to a real `it(...)` calling
   `runBilledGate("<name>")` (assert `hasRealInvoice` + `passesHard`).

## The ±5% claim — what it takes

- **Target accuracy:** ±2% of billed cost (methodology §4.2).
- **Hard gate (Phase 1):** ±5% (methodology §4.6).
- **The ±5% CLAIM is NOT made until ≥3 diverse real traces + real invoices land**
  (methodology §4.1: a multi-turn agent with tools, ≥1 with caching, ≥1 reasoning model,
  mix of text/code/structured). A single passing fixture is necessary but **not** sufficient.
- **Hard rule:** *"If Phase 1 fails or `raw_*` not captured, do not claim ±5%."* (§4.6)
- For a full **cross-model** ±5% claim, also run Phase 3 (`docs/SPEC-phase3-replay.md`).
