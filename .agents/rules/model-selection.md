# Model Selection Rules

Apply by task complexity, not by skill identity. Use portable model tiers in canonical `.agents` files; harness overlays may map those tiers to concrete model ids.

## Portable Tiers

| Tier | Use for |
|------|---------|
| `fast-model` | File reads, listings, classification, date math, simple extraction, count-based checks, lightweight summaries, mechanical scans |
| `default-model` | Standard reasoning, sprint queues, prompt authoring, daily note synthesis, normal code/vault edits, weekly review synthesis |
| `pro-model` | Adversarial review, architecture decisions, multi-doc synthesis, pre-mortems, novel strategy, high-consequence judgment |

## Sub-Agent Default

When using sub-agents, use `GPT-5.3-Codex-Spark` unless the user says otherwise. If the harness only accepts portable tiers, map that default to the nearest available `default-model` tier and reserve `pro-model` for explicit high-complexity work.

## How To Apply

- Put a `model:` field in agent frontmatter when the harness reads it.
- In skill SOPs, annotate per-step model only when a step diverges from the skill's default complexity.
- Do not use retired or harness-specific model names in canonical `.agents` files unless the file is explicitly a harness adapter.

## Why This Matters

P2 applies: keep judgment load-bearing. Cheap/simple work should run on cheaper/faster tiers; reserve expensive reasoning for decisions where synthesis quality changes the outcome.
