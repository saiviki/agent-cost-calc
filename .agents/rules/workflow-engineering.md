# Workflow-Engineering Rule

Policy for how skills and multi-agent orchestrators in this repo are built and changed. Distilled
from two freshly-processed clippings:
- Anthropic, "Claude Code Workflows — How They Work and Best Practices"
- Nick Nisi (WorkOS), "How I deleted 95% of my agent skills and got better results"

Sister rules: `.agents/rules/testing-evidence.md` (the enforcement instance), `.agents/rules/agent-design.md`,
`.agents/rules/model-selection.md`, `.agents/rules/preamble-tiers.md`.

## Imperatives (strong language on purpose — ambiguity weakens a policy file)

1. **Solver + critic, always.** Every multi-step skill ends in a SEPARATE critic/verification pass,
   not a self-check by the solver. `bmad-dev-epic-orchestrator` already embodies this: dev (solver) →
   adversarial review (critic swarm) → fix → re-review loop until below threshold.

2. **Enforce with code/state, not prompts.** Gates re-read the artifact and HALT; they never trust a
   self-reported "done". A self-report is a hint, not proof. See the findings-persistence gate and the
   test-evidence gate as the canonical patterns to copy.

3. **Guide, don't prescribe.** Skills carry GOTCHAS / LANDMINES — the repo- and product-specific
   things the model gets wrong — not an exhaustive restatement of knowledge the model already has.
   Nick Nisi deleted 95% of a 10,000-line generated skill set (down to 553 lines of hand-written
   gotchas) and accuracy ROSE while eval time dropped 68→6 min. More prose is a regression risk.

4. **Measure, don't pursue.** A change to a skill is validated against an eval set BEFORE it's trusted.
   One skill silently dropped a task from 97%→77% correct; only evals caught it. Bigger ≠ better.
   See `.agents/skills/bmad-dev-epic-orchestrator/references/evals.md` for the BMAD eval plan, and the
   `Eval-Judge Agent` (`.agents/agents/eval-judge-agent.md`) as the executor.

5. **Spend the expensive model only where reasoning compounds.** Cheap wide net (`fast-model` hunters),
   expensive narrow synthesis (`pro-model` triage), cheap revision (`default-model` fix). Pin per-call, never inherit
   (`.agents/rules/model-selection.md`).

6. **Human approval at the spec→dev boundary, not mid-run.** Workflows can't take arbitrary mid-run
   input; the spec gate is the natural checkpoint. Mid-run HALTs are for blocking decisions only.

7. **Every failure is a harness bug.** When an orchestrated run misbehaves, fix the
   skill/gate/prompt so it can't recur — don't just patch the one output. Codify the fix; that's the
   flywheel that makes workflows reliable.
