# Agent Cost Calculator

Model the real cost of running an AI agent before you scale.

Configure your agent's token profile, tool calls, caching strategy, and volume — get an instant cost breakdown across a curated model lineup. Optionally paste simple usage JSON/CSV to fill the sliders from a real run.

**Live:** [agent-cost-calc-saiviki.vercel.app](https://agent-cost-calc-saiviki.vercel.app)

## What it does

- Pick from a **curated 16-model lineup** spanning frontier, mid, and budget tiers — both closed (Claude, GPT, Gemini, Grok) and open-weights (DeepSeek, Kimi, Qwen, Llama, MiniMax, Mistral)
- Filter by **tier** (Frontier / Mid / Budget), **type** (Closed / Open-weights), or **strength** (Coding / Reasoning / Multimodal / Long-context / Fast / General)
- Set token counts: system prompt, input per run, output per run
- Configure tool calls: how many per run, avg tokens each
- Tune cache hit rate: see the real impact of prompt caching
- Set volume: runs/day → daily + monthly cost estimate
- **Paste usage** (optional): simple JSON or unquoted CSV of spans → fills the same sliders

Side-by-side comparison sorts by cost (cheapest first) and updates as you adjust filters and inputs.

models.dev supplies **pricing and metadata for these editorial entries only**. The app does not auto-expose the full models.dev catalog.

## Trace Analyzer (retired)

The Trace Analyzer (`/trace`) and its classifier / recommendation / retokenization / replay / billed-cost stack were removed in this simplification.

The last commit that still contains that implementation is [`c48c6ad`](https://github.com/saiviki/agent-cost-calc/commit/c48c6ad64bda04d92db2c9915088e46e2efe0c2d) (`docs: document billed-accuracy gate status and real-trace sources`). Recover it from git history; it is not archived in this tree. `/trace` now explains the retirement.

## Stack

- Next.js + React 19
- Tailwind CSS
- Zero backend — all calculation runs client-side

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Pricing sync

Pricing comes from [models.dev/catalog.json](https://models.dev/catalog.json) for the editorial lineup in `scripts/model-catalog.ts`. Each row records `modelDeveloper`, `pricingProvider`, `sourceId`, and `pricingStatus` (`live` | `carried-forward`). See [docs/DATA-PIPELINE.md](docs/DATA-PIPELINE.md).

```bash
npm run sync-models:refresh  # fetch models.dev and rewrite the curated snapshot
npm run sync-models:check    # offline validation of the committed snapshot
```

`sync-models:check` is deterministic and does not use the network. Refresh is an explicit operator step: review the diff, then commit. Suggested cadence is weekly.

Carried-forward entries stay in the table with a **carried-forward** badge:

- `grok-4.1-fast` maps to `xai/grok-4.1-fast` but no provider currently lists a price. It is **not** remapped to Grok 4.3/4.5/4.6.
- `llama-3.3-70b` maps to `meta/llama-3.3-70b-instruct`. Meta has no list price; host quotes diverge, so no fallback provider is configured.

## Paste usage format

JSON:

```json
{
  "model_id": "claude-sonnet-4-6",
  "spans": [
    { "input_tokens": 4200, "output_tokens": 890, "cached_tokens": 1800, "tool_name": "retriever" }
  ]
}
```

CSV header: `input_tokens,output_tokens,cached_tokens,tool_name,model_id`

**Quoted CSV fields are not supported.** Use unquoted CSV or JSON. The parser rejects quotes rather than mis-splitting fields.

Span tokens are summed into the per-run inputs. Cache hit rate = Σ cached / Σ input. `cached_tokens` may not exceed `input_tokens`. Tool-named spans set the tool-call count (their tokens stay in the input/output totals to avoid double-counting).

Omitted `model_id` defaults to `claude-sonnet-4-6`. An unknown `model_id` is an error, not a silent fallback. System prompt is set to 0 (not in the format). **Runs/day is left unchanged.**

Maximum paste size: 64 KiB. Token fields must be finite, non-negative, and at most 10,000,000.

## Deploy

One-click to Vercel: [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/saiviki/agent-cost-calc)
