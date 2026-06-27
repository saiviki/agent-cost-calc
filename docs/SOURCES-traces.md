# SOURCES — Real traces + invoice $ for the billed-accuracy gate

> How to obtain the two things this repo cannot generate: (a) real provider
> traces carrying raw `usage`, and (b) the matching real per-run invoice $.
> The repo's parser needs the former; the gate's honesty needs the latter.

## What the parser requires (a real trace must carry)

`src/lib/parseTrace.ts` reads the provider-shaped `usage` object verbatim:

| Provider | Required fields (under `usage`) |
|---|---|
| Anthropic (incl. Claude Code `.jsonl`) | `input_tokens`, `output_tokens`, optional `cache_read_input_tokens`, `cache_creation_input_tokens` |
| OpenAI | `prompt_tokens`, `completion_tokens`, optional `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` |
| Gemini | `usage_metadata.prompt_token_count`, `candidates_token_count`, optional `cached_content_token_count`, `thoughts_token_count` |

A trace that lacks these blocks (e.g. only `messages` + tool calls, no per-call
`usage`) cannot be graded — it has no token ground truth.

## Trace sources

### Your own sessions (cheapest, has matching invoice)
- **Claude Code**: `~/.claude/projects/<project-hash>/<session-id>.jsonl`
- **OpenAI / Gemini**: capture a raw Chat Completions / `GenerateContent`
  response. The `usage` object in the response is the ground truth.
- **Invoice $**: read the `request_id` from the response, look it up in the
  provider's usage dashboard, or read the billing API for that day.

### Public datasets (traces only, NO invoices)
- **`trace-commons/agent-traces`** (Hugging Face, CC-BY-4.0): raw, anonymized
  Claude Code / Codex / Cursor / pi / opencode session files. Claude Code
  `.jsonl` files carry Anthropic `usage` blocks and parse cleanly through this
  repo's `.jsonl` path. **They carry no invoice $** — usable for arithmetic /
  token-ground-truth checks, **not** for billed accuracy. 30 sessions, 127 MB.
  https://huggingface.co/datasets/trace-commons/agent-traces
- Provider example responses in API docs are usually truncated — not useful.

### Why public datasets can never close the billed gate
Billed accuracy requires the operator's real dashboard $ for the exact calls in
the trace. No public dataset ships this (it is private billing data). A public
trace can validate Phase 1 arithmetic; only your own invoice can validate Phase
1 billing.

## License / privacy note
Public traces are best-effort anonymized, not certified anonymous (see the
dataset card). Do not paste traces containing employer/client/secret material
into this repo. Prefer your own sessions from public, open-source work.
