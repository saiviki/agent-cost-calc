# AGENTS.md

Canonical instruction file for this repo. Every coding CLI reads this file natively (Grok CLI, Cursor CLI, OpenCode, Claude Code via `CLAUDE.md`). Read it first, then the rules it points to.

Project: `agent-cost-calc`
Stack: `Next.js 15 + TypeScript + vitest, deployed on Vercel`
Test command: see `harness.env` (`TEST_CMD`)

## Operating model (who does what)

| Role | Who | Never does |
|---|---|---|
| **Plan / spec author** | Claude (Fable or Opus), sparingly, or the human | Build code |
| **Builder** | GLM-5.3-flash via OpenCode (`zai-coding-plan` or `opencode-go`), Grok CLI, Cursor CLI | Self-certify. Skip the evidence script. |
| **Critic** | A *different* model from the builder: GLM-5.3 (non-flash) review agent, a cross-vendor model on OpenCode Go, Grok, or Claude for high-stakes | Edit files |
| **Gatekeeper** | `scripts/check-evidence.sh` (recomputes proof) and the human merge | Trust a "done" claim |

Expensive models write plans and review; cheap models build. See `.agents/rules/model-routing.md`.

## Story execution protocol (builders follow this exactly)

You are handed one story file under `docs/stories/`. Do this, in order:

1. Read this file, `harness.env`, and the story. Read `.agents/rules/testing-evidence.md`. Do not read the whole repo speculatively; read what the story names plus what your changes touch.
2. Restate the acceptance criteria as a checklist at the top of your working notes. If a criterion is ambiguous, pick the most conservative reading and record the assumption in the report. Do not stop to ask.
3. Write or extend the tests named in the story's **Test plan** first. Run them and watch them fail for the right reason.
4. Implement the smallest change that satisfies the criteria. Stay inside **Scope**; anything under **Non-goals** is off limits even if it looks easy.
5. Produce evidence with the script, never by hand:
   ```
   bash scripts/verify-test-evidence.sh "$TEST_CMD" docs/evidence/<story-id>/tests.json
   ```
   The script captures real output and hashes it. A touched or hand-written file fails the gate.
6. Run `bash scripts/check-evidence.sh <story-id>`. If it prints FAIL, you are not done.
7. Write `docs/stories/<story-id>.report.md`: criteria checklist with pass/fail, files changed, assumptions, anything out of scope you noticed (do not fix it), and the evidence hash.
8. Do not commit or push unless the story's **Definition of done** says so. Leave the working tree for the critic and the human.

If you cannot satisfy a criterion, say so in the report and stop. A partial, honest report beats a green-looking fake.

## Review protocol (critics follow this)

Read the story, the report, `git diff`, and the evidence. Re-run `scripts/check-evidence.sh`. Write `docs/stories/<story-id>.review.md` with numbered findings, each with severity (blocker / should-fix / nit), file:line, and the concrete failure scenario. Do not edit source files. Verdict at the top: APPROVE, FIX (list blockers), or REJECT.

## Guardrails

- **Solver + critic, always.** The builder never reviews its own work. Builder and critic must be different models.
- **Enforce with state, not prompts.** Gates re-derive proof (recompute the hash, re-read the artifact). See `.agents/rules/testing-evidence.md`.
- **Data sensitivity.** GLM, OpenCode Go, Grok and Cursor destinations are cleared for `public` and `internal` content only. Anything `confidential`, `financial` or `secret` routes to Claude or stays local. See `.agents/rules/data-sensitivity.md` and `.agents/rules/model-routing.md`. Never write secrets into a story, a report, or a log.
- **Damage control.** `.agents/hooks/damage-control/` blocks destructive Bash/Edit/Write on protected paths in harnesses that support hooks. Where hooks are not supported, the same rules apply by instruction: no `rm -rf`, no force-push, no edits to `.env*`, no rewriting git history.
- **Scope discipline.** One story, one change set. Found a second problem? Note it in the report under "Out of scope, noticed".

## Layout

- `AGENTS.md` (this file) and `CLAUDE.md` (Claude overlay, points here).
- `.agents/` is canonical: `rules/`, `skills/`, `agents/`, `hooks/`. `.claude/` mirrors it (`scripts/sync-claude-mirror.sh`).
- `opencode.json` + `.opencode/prompts/` define the OpenCode `build`, `review`, `plan` agents on GLM.
- `.cursor/rules/harness.mdc` points Cursor at this file.
- `docs/plans/` (plans), `docs/stories/` (executable specs, one per story), `docs/evidence/<story-id>/` (test proof), `docs/decisions/` (short ADRs).
- `scripts/`: `dispatch.sh` (run a story on a chosen CLI), `check-evidence.sh` (the gate), `verify-test-evidence.sh` (evidence producer), `harness-status.sh`, `harness-doctor.sh`, `new-story.sh`, `new-project.sh`, `install-harness.sh`, `sync-claude-mirror.sh`.
- `.agents/skills/harness-orchestrator/`: the coordinator skill (`/harness setup|run|queue|status|doctor`), local or with supervised Orca workers.
- `harness.env`: `TEST_CMD`, default models and providers for `dispatch.sh`.

## Session start (interactive use)

1. Read this file and `harness.env`.
2. Read `.agents/rules/model-routing.md` and `.agents/rules/testing-evidence.md`.
3. If you were pointed at a story, follow the execution protocol above. Otherwise ask which story.

## BMAD orchestrators (optional, heavier flow)

`.agents/skills/bmad-spec-epic-orchestrator` and `bmad-dev-epic-orchestrator` drive epics through spec and dev loops with a separate critic. They need the per-story BMAD skills (`bmad-dev-story`, `bmad-create-story`, `bmad-code-review`) installed separately. For single stories, `scripts/dispatch.sh` is the light path and the default.
