# Agent Cost Calculator

Model the real cost of running an AI agent before you scale.

Configure your agent's token profile, tool calls, caching strategy, and volume — get an instant cost breakdown across the top models.

**Live:** [agent-cost-calc-saiviki.vercel.app](https://agent-cost-calc-saiviki.vercel.app)

## What it does

- Pick a model: Claude, GPT-4o, Gemini
- Set token counts: system prompt, input per run, output per run
- Configure tool calls: how many per run, avg tokens each
- Tune cache hit rate: see the real impact of prompt caching
- Set volume: runs/day → daily + monthly cost estimate

Side-by-side model comparison updates in real time as you adjust.

## Stack

- Next.js 15 + React 19
- Tailwind CSS
- Zero backend — all calculation runs client-side

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

One-click to Vercel: [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/saiviki/agent-cost-calc)

## Pricing sources

Prices are sourced from each provider's public pricing page and updated manually. They may lag actual provider pricing — always verify before making production decisions.

| Model | Input /1M | Output /1M | Cache read /1M |
|-------|-----------|------------|----------------|
| Claude Sonnet 4.6 | $3.00 | $15.00 | $0.30 |
| Claude Haiku 4.5 | $0.80 | $4.00 | $0.08 |
| Claude Opus 4.6 | $15.00 | $75.00 | $1.50 |
| GPT-4o | $2.50 | $10.00 | $1.25 |
| GPT-4o mini | $0.15 | $0.60 | $0.075 |
| Gemini 1.5 Pro | $1.25 | $5.00 | — |
| Gemini 1.5 Flash | $0.075 | $0.30 | — |
