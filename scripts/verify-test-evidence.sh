#!/usr/bin/env bash
# verify-test-evidence.sh — run tests and emit cryptographic proof they actually ran.
#
# WHY THIS EXISTS
#   Agents fake test runs by touching the expected-output file ("yep, I ran the tests").
#   The fix (Nick Nisi / WorkOS): capture the REAL test output, SHA-256 it, and have the
#   orchestrator RECOMPUTE the hash. A touched/empty/hand-written evidence file can't match
#   a genuine run, so the cheapest path becomes doing the real work instead of lying.
#
# HOW IT'S USED
#   Drop this into each BMAD code repo under scripts/. The dev/fix sub-agents
#   spawned by bmad-dev-epic-orchestrator are contracted to run it; the orchestrator's
#   test-evidence gate (step-02 §4b / step-04 §6) recomputes the hash of the captured output.
#   Hand-editing the evidence JSON or its .out file will FAIL verification.
#
# USAGE
#   bash scripts/verify-test-evidence.sh "<test-command>" "<evidence-path.json>"
#
#   <test-command>     e.g. "uv run pytest -q"  (quote it; runs via the shell)
#   <evidence-path>    e.g. ".../reviews/wb-b-1-tests-dev-r1.json"
#                      captured output is written beside it as <evidence-path%.json>.out
#
# EXIT CODE
#   Mirrors the test command's exit code (0 = green). Evidence is written regardless so a
#   red run is still provable.

set -u

cmd="${1:-}"
evidence="${2:-}"

if [ -z "$cmd" ] || [ -z "$evidence" ]; then
  echo "usage: verify-test-evidence.sh \"<test-command>\" \"<evidence-path.json>\"" >&2
  exit 2
fi

# Derive the captured-output path: strip a trailing .json, append .out
case "$evidence" in
  *.json) out="${evidence%.json}.out" ;;
  *)      out="${evidence}.out" ;;
esac

# Ensure the artifact directory exists.
evidence_dir="$(dirname "$evidence")"
mkdir -p "$evidence_dir" || { echo "cannot create evidence dir: $evidence_dir" >&2; exit 2; }

# Run the tests; capture combined stdout+stderr to the .out file AND stream to the console.
# Use a subshell so the exit code is the test command's, not tee's.
set -o pipefail 2>/dev/null || true
( eval "$cmd" ) 2>&1 | tee "$out"
exit_code=${PIPESTATUS[0]:-$?}

# Compute SHA-256 of the captured output. Prefer sha256sum, fall back to shasum.
if command -v sha256sum >/dev/null 2>&1; then
  sha256="$(sha256sum "$out" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  sha256="$(shasum -a 256 "$out" | awk '{print $1}')"
else
  echo "no sha256 tool (sha256sum/shasum) found" >&2
  exit 2
fi

# Last non-empty line of output as a human summary (e.g. pytest's "5 passed in 1.2s").
summary="$(grep -v '^[[:space:]]*$' "$out" | tail -n 1 | tr -d '\r')"

# Timestamp in ISO-8601 UTC.
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# JSON-escape a string (backslash, double-quote, tab, newline).
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g'
}

cmd_esc="$(json_escape "$cmd")"
out_esc="$(json_escape "$out")"
summary_esc="$(json_escape "$summary")"

cat > "$evidence" <<EOF
{
  "command": "$cmd_esc",
  "exit_code": $exit_code,
  "sha256": "$sha256",
  "summary": "$summary_esc",
  "captured_output_file": "$out_esc",
  "timestamp": "$timestamp"
}
EOF

echo "test-evidence written: $evidence (exit_code=$exit_code, sha256=$sha256)" >&2
exit "$exit_code"
