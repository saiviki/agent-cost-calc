---
id: {{ID}}
title: {{TITLE}}
status: ready            # draft | ready | in-progress | review | done | blocked
data_class: internal     # public | internal | confidential | financial  (above internal = Claude lane only)
lane: build              # build | plan | owner
builder: glm             # glm | go | grok | cursor | claude
critic: glm-review       # glm-review | grok | claude
size: S                  # S (<2h cheap-model), M (half day), L (split it)
depends_on: []
repo: {{REPO}}
created: {{DATE}}
---

# {{ID}}: {{TITLE}}

## Goal
One paragraph. What is true after this story that is not true now, and why it matters.

## Context the builder needs
Only what is not obvious from the repo. File paths, existing functions to reuse, decisions already made, links to the plan. No prose the builder will not use.

## Scope
- Bullet list of the changes to make. Concrete: file, function, behaviour.

## Non-goals
- Things that look adjacent and must NOT be done. Be explicit; cheap models drift.

## Acceptance criteria
Each one checkable by a test or a command.
1. ...
2. ...

## Test plan
- New/changed tests, by file and name, and what each asserts.
- Fixtures to add (real captured samples preferred over synthetic).

## Evidence
```
bash scripts/verify-test-evidence.sh "$TEST_CMD" docs/evidence/{{ID}}/tests.json
bash scripts/check-evidence.sh {{ID}}
```
Plus any behavioural artifact the story needs (a captured run log, a screenshot, a diff of real output).

## Definition of done
- All criteria pass with evidence; report written to `docs/stories/{{ID}}.report.md`.
- Critic verdict APPROVE in `docs/stories/{{ID}}.review.md`.
- Commit policy: `no-commit` (default; human commits) | `commit-on-branch <name>` | `commit-and-push <branch>`.

## Owner gates (things only the human can do)
- None / list them.
