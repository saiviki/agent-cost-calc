# Agent Cost Calculator

Model the real cost of running an AI agent before you scale.

Configure your agent's token profile, tool calls, caching strategy, and volume — get an instant cost breakdown across a curated model lineup. Optionally paste simple usage JSON/CSV to fill the sliders from a real run.

**Live:** [agent-cost-calc-saiviki.vercel.app](https://agent-cost-calc-saiviki.vercel.app)

## What it does

- Pick from a **curated model lineup** spanning frontier, mid, and budget tiers — closed and open-weights
- Filter by **tier**, **type** (Closed / Open-weights), or **strength**
- Set token counts: system prompt, input per run, output per run
- Configure tool calls and cache hit rate
- Set volume: runs/day → daily + monthly cost estimate
- **Paste usage** (optional): simple JSON or CSV of spans → fills the same sliders

Side-by-side comparison sorts by cost (cheapest first) and updates as you adjust filters and inputs.

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

Pricing and metadata come from [models.dev's catalog API](https://models.dev/catalog.json). Editorial curation (tier, strengths, verbosity multipliers) lives in `scripts/model-catalog.ts`.

```bash
npm run sync-models        # refresh src/lib/pricing.generated.json
npm run sync-models:check  # verify without writing
```

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

Span tokens are summed into the per-run inputs. Cache hit rate = Σ cached / Σ input. Tool-named spans set the tool-call count (their tokens stay in the input/output totals to avoid double-counting).

## Deploy

One-click to Vercel: [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/saiviki/agent-cost-calc)
