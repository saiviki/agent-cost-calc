#!/usr/bin/env bash
# harness-status.sh: one line per story: id, status, lane, gate, verdict, last dispatch.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
[ -f harness.env ] && . ./harness.env
STORIES_DIR="${STORIES_DIR:-docs/stories}"; EVIDENCE_DIR="${EVIDENCE_DIR:-docs/evidence}"
printf '%-8s %-12s %-7s %-6s %-9s %-22s %s\n' ID STATUS BUILDER GATE VERDICT LAST-DISPATCH TITLE
for f in "$STORIES_DIR"/*.md; do
  case "$(basename "$f")" in _TEMPLATE.md|README.md|*.report.md|*.review.md) continue;; esac
  id="$(sed -n 's/^id:[[:space:]]*//p' "$f" | head -1)"; [ -n "$id" ] || continue
  st="$(sed -n 's/^status:[[:space:]]*//p' "$f" | head -1 | awk '{print $1}')"
  lane="$(sed -n 's/^builder:[[:space:]]*//p' "$f" | head -1 | awk '{print $1}')"
  title="$(sed -n 's/^title:[[:space:]]*//p' "$f" | head -1 | cut -c1-50)"
  if [ -f "$EVIDENCE_DIR/$id/tests.json" ]; then
    if bash scripts/check-evidence.sh "$id" >/dev/null 2>&1; then gate=PASS; else gate=FAIL; fi
  else gate="-"; fi
  if [ -f "$STORIES_DIR/$id.review.md" ]; then verdict="$(head -20 "$STORIES_DIR/$id.review.md" | grep -oE 'APPROVE|FIX|REJECT' | head -1)"; verdict="${verdict:-?}"; else verdict="-"; fi
  lastf="$(ls -t "$EVIDENCE_DIR/$id"/dispatch-*.log 2>/dev/null | head -1)"
  last="$(printf '%s' "$lastf" | sed -E 's/.*dispatch-//; s/\.log$//')"
  # A 0-byte log means the CLI is still running (opencode buffers until exit) or died before writing.
  [ -n "$lastf" ] && [ ! -s "$lastf" ] && last="$last (0B: running or dead)"
  printf '%-8s %-12s %-7s %-6s %-9s %-22s %s\n' "$id" "${st:-?}" "${lane:--}" "$gate" "$verdict" "${last:--}" "$title"
done
