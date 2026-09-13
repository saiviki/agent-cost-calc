#!/usr/bin/env bash
# new-story.sh: create docs/stories/<ID>-<slug>.md from the template.
#   bash scripts/new-story.sh S1-07 "Nightly canary workflow"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
[ -f harness.env ] && . ./harness.env
STORIES_DIR="${STORIES_DIR:-docs/stories}"
id="${1:?usage: new-story.sh <ID> \"<title>\"}"; title="${2:?usage: new-story.sh <ID> \"<title>\"}"
slug="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' | cut -c1-60)"
out="$STORIES_DIR/$id-$slug.md"
[ ! -e "$out" ] || { echo "exists: $out" >&2; exit 1; }
repo="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")"
sed -e "s/{{ID}}/$id/g" -e "s/{{TITLE}}/$(printf '%s' "$title" | sed 's/[&/\]/\\&/g')/g" -e "s/{{REPO}}/$repo/g" -e "s/{{DATE}}/$(date -u +%Y-%m-%d)/g" "$STORIES_DIR/_TEMPLATE.md" > "$out"
echo "created $out"
