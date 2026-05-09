# Agent Cost Calculator

Model the real cost of running an AI agent before you scale.

Configure your agent's token profile, tool calls, caching strategy, and volume — get an instant cost breakdown across the top models.

**Live:** [agent-cost-calc-saiviki.vercel.app](https://agent-cost-calc-saiviki.vercel.app)

## What it does

- Pick a model from the current top-tier lineup (Claude 4.x, GPT-5, Gemini 2.5)
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

Verified 2026-05-09 against provider docs. Always re-verify before making production decisions.

| Model | Input /1M | Output /1M | Cache read /1M |
|-------|-----------|------------|----------------|
| Claude Opus 4.7 | $5.00 | $25.00 | $0.50 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $0.30 |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 |
| GPT-5 | $1.25 | $10.00 | $0.125 |
| GPT-5 mini | $0.25 | $2.00 | $0.025 |
| GPT-5 nano | $0.05 | $0.40 | $0.005 |
| GPT-4.1 | $2.00 | $8.00 | $0.50 |
| Gemini 2.5 Pro | $1.25 | $10.00 | $0.125 |
| Gemini 2.5 Flash | $0.30 | $2.50 | $0.03 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.01 |

Sources: [Anthropic](https://docs.claude.com/en/docs/about-claude/models/overview) · [Google](https://ai.google.dev/gemini-api/docs/pricing) · OpenAI (via [helicone.ai/llm-cost](https://www.helicone.ai/llm-cost) — OpenAI's docs page blocks scraping). Gemini 2.5 Pro pricing shown is the ≤200k-token tier (>200k roughly doubles). Anthropic prompt-cache pricing follows the standard `read = 0.1 × input, write = 1.25 × input`.
