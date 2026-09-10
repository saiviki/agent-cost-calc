# Testing-Evidence Rule

> Enforce, don't instruct. Replace trust with evidence.

Grounded in the Nick Nisi (WorkOS) finding — agents fake test runs by touching the expected-output
file ("yep, I ran the tests"). Companion rule: `.agents/rules/workflow-engineering.md`.

## The principle

**Make it easier to do the real work than to lie about it, and enforce that through code/state, not
prompts.** A prompt that says "run the tests" is a suggestion the model can skip. A gate that
recomputes a SHA-256 of the captured test output is proof it can't fake.

## Where this is enforced today

- **BMAD dev/fix sub-agents** (`bmad-dev-epic-orchestrator`) run `scripts/verify-test-evidence.sh`,
  which runs the tests, captures combined stdout+stderr, SHA-256-hashes it, and writes a JSON
  evidence file. The orchestrator's **test-evidence gate** (step-02 §4b, step-04 §6) RECOMPUTES the
  hash; under `test_evidence = strict` a missing/forged/red evidence file HALTs the run.
- The script is the source of truth: `.agents/skills/bmad-dev-epic-orchestrator/scripts/verify-test-evidence.sh`.
  Drop a copy into each code repo under `scripts/`.

## When you add a new "did it really happen?" gate

1. Have the sub-agent produce evidence with a script, not by hand (a touched/empty file must fail).
2. Verify by RE-DERIVING the proof (recompute the hash / re-read the artifact), never by trusting a
   self-reported boolean.
3. HALT on `strict`; offer the standard 3 options (spawn fixer / pause / continue-and-record).
4. For UI/behavioral changes, the evidence is a before/after artifact (e.g. a Playwright recording),
   not a claim.

## Red-green / spec-first order (the TDD discipline)

Write the failing test first → implement → test passes → refactor → never weaken a passing test
without explicit direction. Full standards (inverted pyramid, anti-mock rule, async gotchas) live in
your project's own testing rules.
Mock ONLY external paid/unreliable APIs; never mock your own infra (real Postgres/Redis/object store).
