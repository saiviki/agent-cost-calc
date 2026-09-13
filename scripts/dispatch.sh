#!/usr/bin/env bash
# dispatch.sh: run one story on a chosen coding CLI, headless, then run the evidence gate.
#
#   bash scripts/dispatch.sh <story-id|story-file> [--via glm|go|grok|cursor|claude] [--model M]
#                            [--review] [--with-review] [--dry-run]
#
#   --via         builder lane (default: glm = OpenCode + zai-coding-plan/glm-5.3-flash)
#   --model       override the model for that lane
#   --review      run the CRITIC instead of the builder (default critic: OpenCode review agent on glm-5.3;
#                 combine with --via grok or --via claude for a cross-vendor critic)
#   --with-review append the latest <id>.review.md to the builder prompt (fix round)
#   --dry-run     print the prompt and command, run nothing
#   --prompt-only print only the prompt text (feed it to an Orca task spec), run nothing
#
# Refuses to send a story whose data_class is above `internal` to a non-Claude lane.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.grok/bin:$HOME/bin:$PATH"   # per-user CLI installs; non-login shells miss them

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f harness.env ] && . ./harness.env
STORIES_DIR="${STORIES_DIR:-docs/stories}"
EVIDENCE_DIR="${EVIDENCE_DIR:-docs/evidence}"
GLM_PROVIDER="${GLM_PROVIDER:-zai-coding-plan}"
GLM_BUILD_MODEL="${GLM_BUILD_MODEL:-glm-5.3-flash}"
GLM_REVIEW_MODEL="${GLM_REVIEW_MODEL:-glm-5.3}"

target="${1:-}"; shift || true
[ -n "$target" ] || { sed -n '2,14p' "$0"; exit 2; }
via="glm"; model=""; mode="build"; with_review=0; dry=0
while [ $# -gt 0 ]; do
  case "$1" in
    --via) via="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
    --review) mode="review"; shift ;;
    --with-review) with_review=1; shift ;;
    --dry-run) dry=1; shift ;;
    --prompt-only) dry=2; shift ;;   # print only the prompt text (for Orca task specs); no mutation
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Resolve the story file and id.
if [ -f "$target" ]; then story="$target"
else story="$(ls "$STORIES_DIR"/"$target"-*.md "$STORIES_DIR"/"$target".md 2>/dev/null | grep -v -E '\.(report|review)\.md$' | head -1 || true)"; fi
[ -n "$story" ] && [ -f "$story" ] || { echo "story not found: $target (looked in $STORIES_DIR)" >&2; exit 2; }
id="$(sed -n 's/^id:[[:space:]]*//p' "$story" | head -1)"
[ -n "$id" ] || id="$(basename "$story" .md | sed -E 's/-.*$//')"
data_class="$(sed -n 's/^data_class:[[:space:]]*//p' "$story" | head -1 | awk '{print $1}')"
data_class="${data_class:-internal}"

# Data fence: only public/internal may leave for GLM, Grok, Cursor.
case "$via" in
  glm|go|grok|cursor)
    case "$data_class" in
      public|internal) ;;
      *) echo "REFUSED: story $id is data_class=$data_class; lane '$via' is cleared for public/internal only. Use --via claude." >&2; exit 3 ;;
    esac ;;
  claude) ;;
  *) echo "unknown lane: $via (glm|go|grok|cursor|claude)" >&2; exit 2 ;;
esac

mkdir -p "$EVIDENCE_DIR/$id"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
log="$EVIDENCE_DIR/$id/dispatch-$mode-$via-$ts.log"

# Build the prompt.
if [ "$mode" = "build" ]; then
  prompt="Read AGENTS.md and harness.env first, then follow the Story execution protocol for the story below. Story id: $id. TEST_CMD is: ${TEST_CMD:-npm test}. Evidence path: $EVIDENCE_DIR/$id/tests.json. Report path: $STORIES_DIR/$id.report.md.

----- STORY ($story) -----
$(cat "$story")
----- END STORY -----"
  if [ "$with_review" = 1 ] && [ -f "$STORIES_DIR/$id.review.md" ]; then
    prompt="$prompt

This is a FIX round. Address every blocker and should-fix in the critic's review below, re-run the evidence, and update the report.
----- REVIEW -----
$(cat "$STORIES_DIR/$id.review.md")
----- END REVIEW -----"
  fi
else
  prompt="Read AGENTS.md first, then follow the Review protocol. You are the CRITIC for story $id. Story file: $story. Builder report: $STORIES_DIR/$id.report.md. Evidence dir: $EVIDENCE_DIR/$id. Re-run: bash scripts/check-evidence.sh $id. Write your findings to $STORIES_DIR/$id.review.md with the verdict line first. Do not edit source files.

----- STORY -----
$(cat "$story")
----- END STORY -----"
fi

# Pick the command.
case "$via" in
  glm|go)
    provider="$GLM_PROVIDER"; [ "$via" = go ] && provider="opencode-go"
    if [ "$mode" = build ]; then m="${model:-$provider/$GLM_BUILD_MODEL}"; agent="build"; else m="${model:-$provider/$GLM_REVIEW_MODEL}"; agent="review"; fi
    # --auto: headless permission mode. Without it opencode blocks on its first permission prompt
    # (it asks before reading harness.env) and, with stdin closed, auto-rejects and exits 0 having done nothing.
    cmd=(opencode run --auto --agent "$agent" -m "$m" "$prompt") ;;
  grok)
    cmd=(grok -p "$prompt" --permission-mode auto); m="${model:-${GROK_MODEL:-}}"; [ -n "$m" ] && cmd+=(-m "$m")
    [ "$mode" = review ] && cmd+=(--deny "Edit" --deny "Write") ;;
  cursor)
    cmd=(agent -p --force --output-format text); m="${model:-${CURSOR_MODEL:-}}"; [ -n "$m" ] && cmd+=(--model "$m"); cmd+=("$prompt") ;;
  claude)
    cmd=(claude -p "$prompt" --permission-mode acceptEdits); m="${model:-${CLAUDE_MODEL:-}}"; [ -n "$m" ] && cmd+=(--model "$m") ;;
esac

if [ "$dry" = 2 ]; then printf '%s\n' "$prompt"; exit 0; fi
echo "story=$id lane=$via mode=$mode model=${m:-default} data_class=$data_class log=$log"
if [ "$dry" = 1 ]; then printf '%s\n' "--- prompt ---" "$prompt" "--- command ---" "${cmd[*]:0:4} ..."; exit 0; fi

# Mark in-progress / review in the story frontmatter (best effort).
if [ "$mode" = build ]; then sed -i.bak -E '0,/^status:.*/s//status: in-progress/' "$story" && rm -f "$story.bak"; else sed -i.bak -E '0,/^status:.*/s//status: review/' "$story" && rm -f "$story.bak"; fi

# stdin closed: a headless CLI must never wait on a terminal. Wall-clock cap: DISPATCH_TIMEOUT (harness.env, default 30 min).
# Note: opencode buffers its output until exit, so the log stays empty while it works; that is normal, not a stall.
set +e
TIMEOUT_BIN="$(command -v timeout || command -v gtimeout || true)"   # macOS has neither until coreutils
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "${DISPATCH_TIMEOUT:-1800}" "${cmd[@]}" </dev/null 2>&1 | tee "$log"
else
  echo "WARN: no timeout/gtimeout on PATH; running without a wall-clock cap (brew install coreutils)" | tee "$log"
  "${cmd[@]}" </dev/null 2>&1 | tee -a "$log"
fi
rc=${PIPESTATUS[0]}
set -e
echo "cli exit code: $rc" | tee -a "$log"
if [ "$rc" = 124 ]; then echo "TIMEOUT after ${DISPATCH_TIMEOUT:-1800}s" | tee -a "$log"; fi

reset_status() { sed -i.bak -E "0,/^status:.*/s//status: $1/" "$story" && rm -f "$story.bak"; }

if [ "$mode" = build ]; then
  if [ "$rc" != 0 ] && [ ! -f "$EVIDENCE_DIR/$id/tests.json" ]; then
    # Dead dispatch (timeout, crash, refused): nothing to gate. Put the story back so the next dispatch is not blocked by WIP.
    reset_status ready
    echo "DISPATCH DIED (exit $rc) before producing evidence; story reset to 'ready'. Inspect $log and ~/.local/share/opencode/log/." >&2; exit 5
  fi
  echo "--- evidence gate ---" | tee -a "$log"
  if bash scripts/check-evidence.sh "$id" 2>&1 | tee -a "$log"; then
    echo "NEXT: bash scripts/dispatch.sh $id --review   (then read $STORIES_DIR/$id.review.md)"
  else
    echo "GATE FAILED for $id. Do not merge. Re-dispatch with the story fixed, or inspect $log." >&2; exit 4
  fi
else
  if [ -f "$STORIES_DIR/$id.review.md" ]; then
    v="$(head -20 "$STORIES_DIR/$id.review.md" | grep -oE 'APPROVE|FIX|REJECT' | head -1)"
    echo "critic verdict: ${v:-not found in first 20 lines of $STORIES_DIR/$id.review.md}"
  else
    reset_status in-progress
    echo "critic did not write $STORIES_DIR/$id.review.md (exit $rc); story left in-progress" >&2; exit 6
  fi
fi
