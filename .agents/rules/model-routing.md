# Model Routing (harness adapter)

Concrete mapping of the portable tiers in `model-selection.md` to the CLIs and subscriptions actually available. This file is the one place harness-specific model names are allowed.

## The rule in one line

**Expensive models plan and judge. Cheap models build. Builder and critic are never the same model.** Claude Fable/Opus usage is scarce: it writes plans, stories and final adversarial reviews, and it never builds.

## Destinations

| Lane | Destination | Model | Invoke | Data ceiling |
|---|---|---|---|---|
| build (default) | OpenCode, z.ai Coding Plan | `zai-coding-plan/glm-5.3-flash` | `scripts/dispatch.sh <story> --via glm` | internal |
| build (alt provider) | OpenCode, OpenCode Go | `opencode-go/glm-5.3-flash` | `--via go` | internal |
| build (second opinion / UI-heavy) | Grok CLI (xAI) | account default, override `GROK_MODEL` | `--via grok` | internal (pending owner decision) |
| build (IDE-grade edits) | Cursor CLI | `composer-2.5` (account default) | `--via cursor` | internal (pending owner decision) |
| critic (default) | OpenCode `review` agent | `zai-coding-plan/glm-5.3` (non-flash) | `--review` | internal |
| critic (cross-vendor, same CLI) | OpenCode Go `review` agent | `opencode-go/kimi-k3`, `opencode-go/deepseek-v4-pro`, `opencode-go/qwen3.8-max` (pick one via `--model`) | `--review --via go --model opencode-go/kimi-k3` | internal |
| critic (cross-vendor) | Grok CLI read-only | account default | `--review --via grok` | internal |
| plan / spec / final review / anything confidential or financial | Claude Code | Fable or Opus | manual, sparingly | confidential |
| secrets, credentials | local only, no model | | | secret |

Tier mapping: `fast-model` = glm-5.3-flash. `default-model` = glm-5.3, Grok, Cursor composer. `pro-model` = Claude.

## Pairings that satisfy "different model for the critic"

- Built on glm-5.3-flash -> review on glm-5.3 (same vendor, different model: acceptable for routine stories) or Grok (cross-vendor: preferred for anything touching money, auth, data loss).
- Built on Grok or Cursor -> review on glm-5.3.
- Anything a human will merge into a paid product's main branch gets one Claude review at the end, on the diff only, not on the whole repo.

## Data sensitivity per destination

Only `public` and `internal` content may be dispatched to GLM (z.ai or OpenCode Go), Grok or Cursor. `confidential` (client names, paid-work code, delegation detail), `financial` (invoices, account numbers, holdings) and `secret` never go to those three. Stories carry a `data_class` field; `dispatch.sh` refuses to send anything above `internal` to a non-Claude lane. Grok and Cursor are classified `internal` until the owner explicitly clears them for more; do not assume.

## Cost posture

- A story on glm-5.3-flash costs cents. Prefer two cheap attempts with a critic in between over one expensive attempt.
- Do not spend Claude on retries of a failing cheap build. Fix the story (the spec was unclear) and re-dispatch cheap.
- Log every dispatch to `docs/evidence/<story-id>/dispatch-*.log` so cost and failure patterns are visible at the weekly review.
