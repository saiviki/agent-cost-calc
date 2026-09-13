# Preamble Tier Rules

Each skill in `.agents/skills/` declares a `preamble-tier: N` (1–4) in its frontmatter. The tier determines how much shared context the active agent should read **before executing the skill's SOP**, so context is loaded at the right depth for the work.

The idea (from the gstack model-overlay pattern): `Tier 1` skills get a minimal bootstrap, `Tier 4` gets the full ethos. Load only what a skill needs — context-window pressure causes measurable performance decay, and smaller context is cheaper.

> **Adapt the load lists to your repo.** The tiers below reference generic context files. Point them at whatever your repo actually uses — a `CONTEXT/` directory, additional rule files under `.agents/rules/`, an architecture doc, etc. The tier *mechanism* is portable; the specific files are yours to define.

---

## Tier definitions

### Tier 1 — Self-contained (no auto-read)
**Load**: nothing. Skill is fully self-contained.
**Use for**: mechanical operations, format conversions, simple captures that don't need cross-session context.

### Tier 2 — Light context
**Load**:
- `AGENTS.md` / `CLAUDE.md` — the repo's operating overlay (who you are, house rules)

**Use for**: skills that need to know the repo's conventions but not the full engineering ethos.

### Tier 3 — Operational
**Load** (in order):
- `AGENTS.md` / `CLAUDE.md`
- `.agents/rules/workflow-engineering.md` — how skills/orchestrators are built here
- `.agents/rules/model-selection.md` — which model tier to spend where

**Use for**: skills that orchestrate sub-agents, classify work, or make autonomous act/draft/escalate decisions.

### Tier 4 — Full ethos
**Load** (in order):
- All Tier 3 files
- `.agents/rules/testing-evidence.md` — the evidence/verification discipline
- `.agents/rules/agent-design.md` — sub-agent contract
- Any repo-specific architecture / domain docs that matter for high-consequence judgment

**Use for**: multi-step orchestrators, deep review, architecture decisions — anywhere full context matters more than speed.

---

## Tier assignments (shipped skills)

| Tier | Skills | Why |
|------|--------|-----|
| **3** | `skill-creator` | Authors new skills; needs the build conventions |
| **4** | `bmad-dev-epic-orchestrator`, `bmad-spec-epic-orchestrator` | Multi-step orchestrators — full judgment |

Add rows as you add skills.

---

## How to apply (per skill)

1. Add `preamble-tier: N` to the skill's frontmatter (after `description`).
2. At the top of the skill body, add a single line referencing this file:
   ```
   > Preamble tier: N — see `.agents/rules/preamble-tiers.md` for context-file loading.
   ```

---

## Re-tiering

If a skill's behavior changes such that its tier should change:
1. Update this file's table.
2. Update the skill's `preamble-tier:` frontmatter.

---

## Reference

- Sister rules: `.agents/rules/model-selection.md`, `.agents/rules/agent-design.md`, `.agents/rules/workflow-engineering.md`
