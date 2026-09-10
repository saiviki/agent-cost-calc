#!/usr/bin/env bash
# check-evidence.sh: the gate. Re-derives the proof instead of trusting the builder.
#   bash scripts/check-evidence.sh <story-id>
# PASS (exit 0) only if docs/evidence/<id>/tests.json exists, its captured output file exists and is
# non-trivial, sha256(captured output) equals the recorded sha256, and the recorded exit_code is 0.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
[ -f harness.env ] && . ./harness.env
EVIDENCE_DIR="${EVIDENCE_DIR:-docs/evidence}"
id="${1:-}"; [ -n "$id" ] || { echo "usage: check-evidence.sh <story-id>" >&2; exit 2; }
ev="$EVIDENCE_DIR/$id/tests.json"
[ -f "$ev" ] || { echo "FAIL $id: no evidence file $ev (builder never ran scripts/verify-test-evidence.sh)"; exit 1; }

read -r recorded exit_code outfile <<EOF
$(python3 - "$ev" <<'PY'
import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(d.get("sha256",""), d.get("exit_code","x"), d.get("captured_output_file",""))
except Exception as e:
    print("", "x", "")
PY
)
EOF
[ -n "$recorded" ] && [ -n "$outfile" ] || { echo "FAIL $id: evidence JSON unreadable or missing fields ($ev)"; exit 1; }
[ -f "$outfile" ] || { echo "FAIL $id: captured output $outfile missing"; exit 1; }
size=$(wc -c < "$outfile" | tr -d ' ')
[ "$size" -ge 40 ] || { echo "FAIL $id: captured output is $size bytes; that is not a test run"; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$outfile" | awk '{print $1}')"; else actual="$(shasum -a 256 "$outfile" | awk '{print $1}')"; fi
[ "$actual" = "$recorded" ] || { echo "FAIL $id: sha256 mismatch (recorded $recorded, actual $actual). Evidence was edited or output regenerated without the script."; exit 1; }
[ "$exit_code" = "0" ] || { echo "FAIL $id: tests exited $exit_code (red run). Summary: $(grep -v '^[[:space:]]*$' "$outfile" | tail -1)"; exit 1; }
red="absent"; [ -f "$EVIDENCE_DIR/$id/tests-red.json" ] && red="present"
echo "PASS $id: sha256 $actual verified, exit 0, red-run evidence $red, $(grep -v '^[[:space:]]*$' "$outfile" | tail -1)"
