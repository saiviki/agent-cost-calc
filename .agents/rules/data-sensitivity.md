# Data-Sensitivity Routing

A portable policy for deciding **what content is allowed to reach which model or surface**. The point is to make the "don't leak sensitive data to the wrong place" rule *checkable* instead of leaving it as prose. Adapt the classes and the matrix to your own threat model and providers.

## Classes

- `public` — already-public data: open-source code, published docs, product/competitor names.
- `internal` — repo notes, project status, roadmaps, non-sensitive metrics.
- `confidential` — client/customer names, paid-work under NDA, unreleased strategy, security-relevant internals.
- `financial` — anything touching money movement, account numbers, card/PAN, bank identifiers.
- `secret` — keys, tokens, recovery codes, credentials of any kind.

## Routing matrix (example — edit the columns to match your providers)

| Class | Primary trusted model | Third-party / cheaper model | local-only / no model |
|-------|:--:|:--:|:--:|
| public | ✅ | ✅ | ✅ |
| internal | ✅ | ✅ | ✅ |
| confidential | ✅ | ❌ | ✅ |
| financial | ⚠️ tokenized only | ❌ | ✅ |
| secret | ❌ | ❌ | ✅ |

## Rules

1. **Surfaces shipped to a less-trusted model must be sensitive-free.** Any queue, digest, or enqueue that a third-party/cheaper model consumes must contain no `confidential`/`financial`/`secret` content. Route sensitive work to a trusted host instead.
2. **Scan gates the dispatch.** Before shipping a file to an external model, gate it with a scan; a hit means skip that file and alert — don't ship it. Enforce with state, not trust.
3. **Never send credential/secret file *content* to any model.** Mechanical operations (rename, move) must not read or log secret/financial values verbatim.
4. **Person/customer names are `confidential`** — keep any watchlist of them out of committed files (e.g. a gitignored local file), never inlined into the repo.

## How to enforce

The matrix above is a spec. To make it real, add a scanner (a script that greps for your codenames / secret patterns / PAN-like strings) and run it as a gate before any dispatch to an external model — exit non-zero + print `BLOCK <path>` on a hit. Wiring that scanner into a hook or CI step is the enforcement mechanism; the rule file is just the policy it enforces.

> This is a starting template. The real leak surfaces are specific to your setup — enumerate them explicitly (which jobs run on which model, what they read) rather than trusting a general rule.
