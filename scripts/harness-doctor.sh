#!/usr/bin/env bash
# harness-doctor.sh: is this repo ready to dispatch stories? Prints a table, exits 1 if any REQUIRED row fails.
set -u
export PATH="$HOME/.local/bin:$HOME/.grok/bin:$HOME/bin:$PATH"   # CLIs installed per-user; non-login shells (Orca, cron) miss them
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
[ -f harness.env ] && . ./harness.env
fail=0
row() { printf '%-4s %-9s %-28s %s\n' "$1" "$2" "$3" "$4"; if [ "$1" = FAIL ] && [ "$2" = required ]; then fail=1; fi; return 0; }
have() { command -v "$1" >/dev/null 2>&1; }
printf '%-4s %-9s %-28s %s\n' OK? LEVEL CHECK DETAIL
for f in AGENTS.md harness.env scripts/dispatch.sh scripts/check-evidence.sh scripts/verify-test-evidence.sh docs/stories/_TEMPLATE.md opencode.json .agents/rules/model-routing.md; do
  [ -f "$f" ] && row OK required "file $f" "" || row FAIL required "file $f" "missing (run install-harness.sh)"
done
if [ -n "${TEST_CMD:-}" ] && ! printf '%s' "$TEST_CMD" | grep -q 'set TEST_CMD'; then
  if (eval "$TEST_CMD") >/tmp/doctor-test.out 2>&1; then row OK required "TEST_CMD runs" "$TEST_CMD"; else row FAIL required "TEST_CMD runs" "$TEST_CMD exited non-zero (see /tmp/doctor-test.out)"; fi
else row FAIL required "TEST_CMD set" "edit harness.env"; fi
if have opencode; then
  models="$(opencode models 2>/dev/null)"
  printf '%s' "$models" | grep -q "^zai-coding-plan/glm-5.3-flash" && row OK optional "opencode: zai-coding-plan" "glm-5.3-flash listed" || row WARN optional "opencode: zai-coding-plan" "not listed (opencode auth login)"
  printf '%s' "$models" | grep -q "^opencode-go/glm-5.3-flash" && row OK optional "opencode: opencode-go" "glm-5.3-flash listed" || row WARN optional "opencode: opencode-go" "not listed"
  # A listed model proves nothing; do one real headless round trip on the configured build lane.
  bm="${GLM_PROVIDER:-zai-coding-plan}/${GLM_BUILD_MODEL:-glm-5.3-flash}"
  if [ "${DOCTOR_SKIP_ROUNDTRIP:-0}" = 1 ]; then row WARN optional "opencode round trip" "skipped (DOCTOR_SKIP_ROUNDTRIP=1)"
  elif timeout 90 opencode run --auto -m "$bm" "Reply with exactly the word PONG and nothing else." </dev/null 2>/dev/null | grep -q PONG; then row OK required "opencode round trip" "$bm answered headless"
  else row FAIL required "opencode round trip" "$bm did not answer within 90s headless (auth? --auto? network?)"; fi
else row FAIL required "opencode installed" "missing: default build lane"; fi
have grok && row OK optional "grok cli" "$(grok --version 2>/dev/null | head -1)" || row WARN optional "grok cli" "not installed"
have agent && row OK optional "cursor cli (agent)" "$(agent --version 2>/dev/null | head -1)" || row WARN optional "cursor cli (agent)" "not installed"
have claude && row OK optional "claude code" "plan/review lane" || row WARN optional "claude code" "not installed"
have python3 && row OK required "python3" "" || row FAIL required "python3" "needed by check-evidence.sh"
(have sha256sum || have shasum) && row OK required "sha256 tool" "" || row FAIL required "sha256 tool" "sha256sum/shasum missing"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  dirty="$(git status --short | grep -vE '^\?\? docs/evidence/|^ M docs/stories/' | wc -l | tr -d ' ')"
  [ "$dirty" = 0 ] && row OK required "git working tree" "clean" || row FAIL required "git working tree" "$dirty non-harness changes; commit or stash before dispatching"
else row WARN optional "git repo" "not a git repo"; fi
O="${ORCA_CLI_COMMAND:-}"; [ -z "$O" ] && { if [ "$(uname -s)" = Linux ] && have orca-ide; then O=orca-ide; elif have orca; then O=orca; fi; }
if [ -n "$O" ] && "$O" status --json >/dev/null 2>&1; then row OK optional "orca runtime" "$O reachable"; else row WARN optional "orca runtime" "not reachable (local dispatch still works)"; fi
[ "$fail" = 0 ] && echo "doctor: READY" || { echo "doctor: NOT READY (fix required rows)"; exit 1; }
