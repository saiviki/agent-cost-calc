# Agent Design Rules

Universal template for sub-agents living in `.agents/agents/`. Pairs with `.agents/rules/model-selection.md` (per-step model) and `.agents/rules/preamble-tiers.md` (per-skill context loading).

**Vision**: A main orchestrator agent delegates to a fleet of specialized sub-agents — instead of doing everything inline. Each sub-agent reads/computes/synthesizes in its own context window and returns only a structured deliverable.

Harness system prompts already enforce their own tool-use and reasoning policies, so do not duplicate those blocks. Repo `memory/feedback_*.md` files (if you keep them) serve as the global learning substrate — no per-agent `lessons.md` needed.

---

## Universal template (3 blocks)

Every agent file under `.agents/agents/<agent-name>-agent.md` must include these three blocks, in order, after the YAML frontmatter:

```markdown
---
name: <Agent Name>                       # exact name used in subagent_type
description: <one-line specialty>
preamble-tier: <1-4>                     # uses .agents/rules/preamble-tiers.md
model: <fast-model|default-model|pro-model> # native or portable model tier; see .agents/rules/model-selection.md
---

# <Agent Name>

## Role

<2-3 sentences: mission + unique expertise. Stay in this lane. Name what
you DO NOT do — the lanes that belong to peer agents or the Orchestrator.>

## Output Template

Every response MUST end with this four-line footer:

**Deliverable**: <the concrete artifact this agent produces>
**Evidence**: <files read, tools called, sources cited — be specific>
**Hand-off**: <@AgentName next | OR → Orchestrator: <one-sentence reason>>
**Confidence**: <1-10>, **Gaps**: <what's uncertain or missing>

## Hand-off Protocol

- Address peer agents by exact name with @-prefix: `@Research Agent`, `@Review Agent`, etc.
- Always end every response with one explicit Hand-off line — back to Orchestrator by default
- If blocked: hand back to Orchestrator with `→ Orchestrator: blocked because <reason>` and any partial deliverable
- If a peer agent has a clear next step in the pipeline, name the peer with @ and what you want from them
```

The body BETWEEN the Role and Output Template sections is the agent's actual SOP — read-X-do-Y-return-Z.

---

## Frontmatter contract

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Exact value used when the orchestrator calls `Agent(subagent_type: "<name>")`. Title Case with spaces, e.g. `"Review Agent"`. |
| `description` | yes | One-line specialty. Surfaces in the agent picker when the orchestrator or a peer chooses who to delegate to. |
| `preamble-tier` | yes (1-4) | Same scale as `.agents/skills/*/SKILL.md`. Most agents are Tier 2 or Tier 3. Tier 1 for fully self-contained mechanical work; Tier 4 only for cross-domain strategic agents. |
| `model` | yes | Portable tier (`fast-model` \| `default-model` \| `pro-model`) unless a harness requires concrete model ids. The orchestrator can still override per-invocation when the tool supports it. |

**Worked example** — pin in frontmatter, optionally override per call:

```markdown
---
name: Review Agent
model: fast-model
---
```
```js
// Orchestrator override for one heavier-than-usual run:
Agent({ subagent_type: "Review Agent", model: "default-model", prompt: "..." })
```

---

## When to create an agent vs keep work inline

Build a sub-agent when **all four** are true:

1. **Multi-step procedure** — at least 3 distinct operations (read X, compute Y, return Z)
2. **Repeated invocation** — runs in 2+ skills OR multiple times per day in one skill
3. **Clean orchestrator-vs-agent boundary** — explicit structured inputs + structured outputs; no follow-up Q&A required mid-task
4. **Reduces orchestrator context window** — the agent reads files / computes / synthesizes in its own context; only the structured deliverable returns

If only some are true:
- **Single-skill + single-step** → inline in the skill SOP
- **Judgment-heavy with no clear inputs** → keep with the orchestrator
- **Pure mechanical edit** → use the Edit/Write tools directly, no agent needed

---

## Hand-off vocabulary

When writing the Hand-off line, use one of these forms:

| Form | Use when |
|------|----------|
| `→ Orchestrator: deliverable ready for injection into <target>` | Standard return to the orchestrator |
| `→ @Peer Agent Name: <specific request>` | Pipeline-able next step |
| `→ Orchestrator: blocked because <reason>; partial deliverable above` | Cannot complete — needs orchestrator judgment or external input |
| `→ Orchestrator: out-of-scope — recommend invoking @<Other Agent>` | Wrong agent picked; suggest the right one |

The orchestrator reads the Hand-off line and decides whether to: inject the deliverable, invoke the named peer, escalate to the user, or accept the block.

---

## Pattern: "wide net (batch) → narrow filter (interactive)"

When a cheap batch job can do broad autonomous work ahead of time, the interactive agent should **NOT replicate** that work. Instead, design the interactive agent as the **last-mile layer**:

| Layer | When | What |
|-------|------|------|
| **Wide net** | Batch / scheduled, cheap model | Broad scanning, initial scoring, generic filtering. Writes an intermediate artifact. |
| **Narrow filter** | Interactive, on demand | READ the batch output, re-rank against current context, synthesize across items, right-size to the actual task, decision-friendly framing |

**Why this matters**: the interactive agent never re-scans sources (saves context window); the batch job runs cheaply ahead of time; each layer plays to its strength — batch = throughput, interactive = personalization.

**When NOT to apply**: no batch equivalent exists; the task is interactive-only; or the agent's job IS the broad scan (you become the wide net, not the narrow filter).

---

## Anti-patterns (do not do these)

- **Don't duplicate the harness system prompt** — no "always use tools first", no "plan mode for ≥3 steps", no "CoT reasoning required". Those are enforced harness-side.
- **Don't add per-agent `lessons.md`** — global feedback lives in the harness memory store and repo memory files. Agents read those if relevant via the preamble-tier loading.
- **Don't write a "Workflow Contract" block** — the 3 universal blocks above are enough. Adding more bloats context.
- **Don't make the Hand-off optional** — every response ends with one, even if it's just `→ Orchestrator: done, no follow-up`.
- **Don't invoke other agents directly from within an agent** — only the orchestrator routes between agents. Agents *suggest* peer hand-offs but the orchestrator executes them.

---

## Reference

- Sister rules: `.agents/rules/model-selection.md`, `.agents/rules/preamble-tiers.md`, `.agents/rules/workflow-engineering.md`, `.agents/rules/testing-evidence.md`
