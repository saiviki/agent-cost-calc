# Agent Cost Calculator

Model the real cost of running an AI agent before you scale.

Configure your agent's token profile, tool calls, caching strategy, and volume — get an instant cost breakdown across the top models.

**Live:** [agent-cost-calc-saiviki.vercel.app](https://agent-cost-calc-saiviki.vercel.app)

## What it does

- Pick from a **curated 16-model lineup** spanning frontier, mid, and budget tiers — both closed (Claude, GPT, Gemini, Grok) and open-weights (DeepSeek, Kimi, Qwen, Llama, MiniMax, Mistral)
- Filter by **tier** (Frontier / Mid / Budget), **type** (Closed / Open-weights), or **strength** (Coding / Reasoning / Multimodal / Long-context / Fast / General)
- Set token counts: system prompt, input per run, output per run
- Configure tool calls: how many per run, avg tokens each
- Tune cache hit rate: see the real impact of prompt caching
- Set volume: runs/day → daily + monthly cost estimate

Side-by-side comparison sorts by cost (cheapest first) and updates as you adjust filters and inputs.

The lineup is curated from **OpenRouter's real-usage rankings** (production traffic across thousands of agent apps), not just "newest models." Many of the headline-newest models — including GPT-5/5.5 — have lower production adoption than Claude Sonnet 4.6 or DeepSeek V4. The picker reflects that.

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

## Lineup

Verified 2026-05-09 against [OpenRouter's unified pricing API](https://openrouter.ai/api/v1/models) (ground-truth across 100+ providers) + Anthropic / Google official docs.

### Frontier

| Model | Provider | Input /1M | Output /1M | Cache read /1M | Open? |
|---|---|---|---|---|---|
| Claude Opus 4.7 | Anthropic | $5.00 | $25.00 | $0.50 | — |
| Claude Sonnet 4.6 | Anthropic | $3.00 | $15.00 | $0.30 | — |
| GPT-5.5 | OpenAI | $5.00 | $30.00 | $0.50 | — |
| Gemini 3.1 Pro | Google | $2.00 | $12.00 | $0.20 | — |
| DeepSeek V4 Pro | DeepSeek | $0.435 | $0.870 | $0.0036 | ✓ |
| Kimi K2.6 | Moonshot | $0.75 | $3.50 | $0.15 | ✓ |

### Mid

| Model | Provider | Input /1M | Output /1M | Cache read /1M | Open? |
|---|---|---|---|---|---|
| Claude Haiku 4.5 | Anthropic | $1.00 | $5.00 | $0.10 | — |
| GPT-5.4 mini | OpenAI | $0.75 | $4.50 | $0.075 | — |
| Gemini 3 Flash | Google | $0.50 | $3.00 | $0.05 | — |
| Grok 4.1 Fast | xAI | $0.20 | $0.50 | $0.05 | — |
| Qwen 3.6 Plus | Alibaba | $0.325 | $1.95 | — | ✓ |

### Budget

| Model | Provider | Input /1M | Output /1M | Cache read /1M | Open? |
|---|---|---|---|---|---|
| GLM 5.1 | Z.ai | $0.14 | $0.14 | — | ✓ |
| DeepSeek V4 Flash | DeepSeek | $0.14 | $0.28 | $0.0028 | ✓ |
| Llama 3.3 70B | Meta | $0.10 | $0.32 | — | ✓ |
| MiniMax M2.7 | MiniMax | $0.30 | $1.20 | — | ✓ |
| Mistral Large 2 | Mistral | $0.50 | $1.50 | $0.05 | ✓ |

### Notes

- **Anthropic prompt caching**: standard `read = 0.10 × input, write_5min = 1.25 × input`.
- **OpenAI cached input**: GPT-5.x family ≈ 0.10 × input.
- **Open-model cache pricing** varies by host (Together, Fireworks, Groq, DeepInfra, etc.); figures here are OpenRouter median rates. Self-hosted = no per-token cost but you pay for compute.
- **Gemini 3.1 Pro pricing** shown is the standard tier; >200k-token requests follow Google's tiered pricing.
- **Lineup curation** prioritizes real-world production usage (OpenRouter top-20) over headline-newest. GPT-5/5.5 is included for completeness but is not currently a top-10 production model by token volume.
