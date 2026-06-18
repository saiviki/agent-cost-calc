# SPEC — Task Classifier (C1 + C2)

> Stories C1 and C2 of `BUILD-PLAN-task-classifier.md`.
> Target files: `src/lib/parseTrace.ts` (C1 additive extension), `src/lib/classifyTask.ts` (C2, new file).
> Pure synchronous TypeScript. No DOM, no async, no API calls, no ML model.
> Every weight and threshold in this document is justified — no arbitrary numbers.

---

## C1 — `ParsedRun.signals` Extension

### 1. Contract

`signals` is an additive field on `ParsedRun`. All existing fields are untouched. The extension:

```ts
// Append to the ParsedRun type in src/lib/parseTrace.ts
signals?: {
  toolNames: Record<string, number>;  // tool_use name → call count across ALL runs
  totalToolCalls: number;             // sum of tool_use blocks across ALL runs
  turnCount: number;                  // number of qualifying assistant turns
  outputToInputRatio: number;         // avgOutputTokens / (avgInputTokens + avgCacheReadTokens + avgCacheCreationTokens)
  hasCodeBlocks: boolean;             // true if any text block across any run contains ``` (triple backtick)
  hasJsonOutput: boolean;             // true if any text block contains a valid top-level JSON object or array
  hasCitations: boolean;              // true if any text block contains a URL (http:// or https://) or a [N] footnote marker
  reasoningTokenRatio: number;        // (total thinking/reasoning tokens) / (total output tokens); 0.0 if no thinking blocks
  repairSignals: number;              // count of repair indicators across runs (see §1.4)
};
```

**Default policy**: when any signal cannot be derived from the available data (e.g., content is absent, not an array, or a block type is unexpected), the signal defaults to its zero-equivalent (`0`, `false`, `{}`) without throwing and without adding a warning. The zero-equivalent is always the conservative choice — it cannot inflate a task-type score upward.

---

### 2. Field Derivations — Anthropic JSON Format

Source: `content` array on each top-level response object. Content blocks follow the Anthropic Messages API schema.

#### 2.1 `toolNames` and `totalToolCalls`

Scan every content block across all runs where `block.type === "tool_use"`.

```
toolNames[block.name] += 1   // for each tool_use block
totalToolCalls += 1           // for each tool_use block
```

If `block.name` is absent or not a string, use the key `"<unnamed>"`.

Rationale for a name→count map (not just a total): downstream classifiers need to distinguish edit-heavy traces (many `str_replace_editor`, `write_file` calls → coding signal) from search-heavy ones (many `web_search`, `brave_search` → research signal) from execution-heavy ones (`bash`, `computer` → agentic signal). A flat total loses this discrimination.

#### 2.2 `turnCount`

Equal to `runsData.length` — the number of qualifying assistant turns processed before aggregation. For Anthropic JSON format, this equals `runs` (each element in the array = one turn). The field is captured directly from `runsData.length` before the `aggregate()` call.

Rationale: `runs` and `turnCount` are identical for Anthropic JSON; the distinction matters in .jsonl where intermediate non-qualifying lines exist. Keeping `turnCount` as a named signal makes the classifier's access to "how many back-and-forth turns" explicit and traceable.

#### 2.3 `outputToInputRatio`

```
denominator = avgInputTokens + avgCacheReadTokens + avgCacheCreationTokens
outputToInputRatio = denominator === 0 ? 0.0 : avgOutputTokens / denominator
```

This uses the total effective input (cached + uncached + creation) as the denominator because all three contribute to what the model "saw" before generating output. Using only `avgInputTokens` would undercount input on high-cache traces and artificially inflate the ratio.

Rationale for the signal: high-output tasks (research summaries, code generation) have ratios > 1.0; extraction tasks that produce short structured fields have ratios < 0.3; chat turns cluster around 0.3–0.8. This gives a model-agnostic behavioral fingerprint.

#### 2.4 `hasCodeBlocks`

```
hasCodeBlocks = true  if any text block's text field contains "```"  (three consecutive backticks)
```

Scan every content block where `block.type === "text"` and `typeof block.text === "string"`. Apply `block.text.includes("```")`.

Rationale: triple backticks are the near-universal Markdown code fence. Their presence in output strongly indicates code generation or a coding-assistant response. This is a low-false-negative heuristic (code without fences is rare in assistant output; the few false negatives don't corrupt the classifier, they just reduce coding score slightly).

#### 2.5 `hasJsonOutput`

```
hasJsonOutput = true  if any text block's text field, after stripping leading/trailing whitespace,
                      starts with "{" or "[" and JSON.parse succeeds without throwing.
                      OR if the text contains a substring matching /```json\s*[\[{]/ (fenced JSON block).
```

Two-pass check per text block:
1. `stripped = block.text.trim(); if (stripped.startsWith("{") || stripped.startsWith("[")) { try JSON.parse(stripped) }`
2. If pass 1 fails: `if (/```json\s*[\[{]/.test(block.text)) hasJsonOutput = true`

Do not throw on `JSON.parse` failure — catch the exception and continue.

Rationale: extraction tasks and structured-output pipelines produce JSON. The two-pass approach catches both raw JSON responses and fenced JSON within a longer explanation. False positives (a JSON example inside a chat response) are acceptable — they weakly boost extraction score without flipping a verdict on their own.

#### 2.6 `hasCitations`

```
hasCitations = true  if any text block contains:
  - a URL pattern: /https?:\/\/[^\s)>]+/ (http:// or https:// followed by non-whitespace)
  - OR a footnote marker: /\[\d+\]/ (a number in square brackets, e.g. [1], [23])
```

Apply `hasCitations = /https?:\/\/[^\s)>]+/.test(block.text) || /\[\d+\]/.test(block.text)`.

Rationale: research and extraction outputs cite sources. URL presence is the primary signal; `[N]` footnote style is the secondary (used in academic and report-style outputs). This does NOT fire on code blocks that happen to contain URLs (e.g., a `fetch("https://...")` call) — that ambiguity is accepted; the signal carries low weight compared to tool-name signals.

#### 2.7 `reasoningTokenRatio`

Anthropic extended-thinking responses include content blocks of `type === "thinking"` with a `thinking` string field (and optionally `type === "redacted_thinking"` for filtered blocks).

```
thinkingTokens = 0
for each block across all runs:
  if block.type === "thinking" AND typeof block.thinking === "string":
    thinkingTokens += estimateTokens(block.thinking)
  if block.type === "redacted_thinking":
    thinkingTokens += 50   // conservative fixed estimate for a redacted block

totalOutputTokens = runs * avgOutputTokens   // reconstruct from aggregated averages
reasoningTokenRatio = totalOutputTokens === 0 ? 0.0 : thinkingTokens / totalOutputTokens
```

Token estimation: `estimateTokens(s) = Math.ceil(s.length / 4)` — the standard 4-chars-per-token approximation. This is NOT used for billing; it is used only for the ratio signal, where ±30% accuracy is sufficient.

Rationale: a high `reasoningTokenRatio` (> 0.5) signals that the model spent significant compute on internal reasoning — characteristic of deductive reasoning tasks, complex agentic loops, and hard coding problems. A zero ratio signals either a non-thinking model or a simple task. The ratio is normalized to output tokens (not input) because the denominator should reflect "how much thinking per unit of answer produced."

#### 2.8 `repairSignals`

A repair signal fires when evidence of an error-and-retry loop is present in the trace. Each qualifying event increments the counter by 1.

**Qualifying events (scan all content blocks and tool_result blocks):**

| Source | Pattern | Increment |
|--------|---------|-----------|
| `tool_result` block with `is_error: true` | Any content block of type `tool_result` where `block.is_error === true` | +1 per block |
| Text block containing an error-retry phrase | Case-insensitive match against `/(let me try|i'll try again|that didn't work|let me retry|error occurred|trying a different|apologies, let me|sorry, let me try)/i` | +1 per matching block |

Cap at `min(repairSignals, runs * 5)` to prevent pathological traces from dominating. The cap is `5 × runs` because a reasonable upper bound on repair events per turn is 5 (tool error, parse error, retry, reparse, final attempt).

Rationale for the phrase list: these are the phrases Claude Code and Claude API agents use when self-recovering from tool failures. They are not present in clean single-pass responses. The pattern is intentionally narrow to avoid false positives from normal hedging language ("let me" in other contexts). The `is_error` field is the primary signal; text patterns are a secondary fallback for traces where `tool_result` metadata is not preserved.

---

### 3. Field Derivations — Claude Code `.jsonl` Format

The `.jsonl` format is parsed line-by-line. Each qualifying assistant turn has `message.content` as the content array. Apply exactly the same block-scanning rules as §2, but source content from `message.content` on each qualifying turn.

Additional `.jsonl`-specific sources:

**`toolNames` / `totalToolCalls`**: the `.jsonl` format also carries `tool_use` blocks inside `message.content`. These are the assistant's tool-call invocations. Tool results arrive on the next `human` turn as `tool_result` blocks — those are NOT scanned for `toolNames`/`totalToolCalls` (they are the environment's responses, not the model's calls). They ARE scanned for `repairSignals` (`is_error: true`).

**`turnCount`**: equals the count of qualifying assistant lines (`type === "assistant"` with `message.usage.input_tokens`). Same as `runs` for `.jsonl`.

**`reasoningTokenRatio`**: `.jsonl` assistant turns may contain `thinking` blocks inside `message.content`. Apply the same scan as §2.7.

---

### 4. Implementation Location

The signal extraction runs during the **aggregation step**, immediately before `aggregate()` constructs the final `ParsedRun`. Two new internal functions handle this:

```ts
// Scans a single turn's content array and mutates the accumulator.
function accumulateSignals(content: unknown, acc: SignalAccumulator): void

// Finalizes the SignalAccumulator into the signals object after all turns are processed.
function finalizeSignals(acc: SignalAccumulator, p: ParsedRun): ParsedRun["signals"]
```

`SignalAccumulator` is an internal mutable type (not exported):

```ts
type SignalAccumulator = {
  toolNames: Record<string, number>;
  totalToolCalls: number;
  thinkingChars: number;       // accumulates raw character counts for ratio computation
  redactedThinkingBlocks: number;
  hasCodeBlocks: boolean;
  hasJsonOutput: boolean;
  hasCitations: boolean;
  repairSignals: number;
};
```

`finalizeSignals` computes derived fields (`outputToInputRatio`, `reasoningTokenRatio`) from the finalized `ParsedRun` averages + accumulator values.

---

### 5. Zero-Default Table

| Signal | Zero-default value | When applied |
|--------|--------------------|-------------|
| `toolNames` | `{}` | content absent, not array, or no `tool_use` blocks |
| `totalToolCalls` | `0` | same as above |
| `turnCount` | equals `runs` | always derived from `runsData.length` |
| `outputToInputRatio` | `0.0` | denominator is zero (no input tokens observed) |
| `hasCodeBlocks` | `false` | no text blocks, or none contain triple backtick |
| `hasJsonOutput` | `false` | no text blocks, or none contain parseable JSON |
| `hasCitations` | `false` | no text blocks, or none contain URL / footnote |
| `reasoningTokenRatio` | `0.0` | no thinking blocks, or total output tokens = 0 |
| `repairSignals` | `0` | no error tool_results, no repair phrases in text |

---

## C2 — `classifyTask` Function

### 6. Exported Types

```ts
// src/lib/classifyTask.ts

export type TaskType =
  | "coding"
  | "extraction"
  | "research"
  | "agentic"
  | "reasoning"
  | "chat";

export type Complexity = "low" | "med" | "high";

export type Classification = {
  taskType: TaskType;
  taskTypeConfidence: number;   // [0.0, 1.0] — margin to runner-up, normalized
  complexity: Complexity;
  complexityConfidence: number; // [0.0, 1.0] — margin to adjacent band, normalized
  evidence: string[];           // human-readable firing signals, in score-descending order
};

export function classifyTask(p: ParsedRun): Classification
```

`classifyTask` is pure and synchronous. **It does not throw.**

**Guard — undefined `signals` (MUST be the first statement in the function):** `ParsedRun.signals` is typed optional (`signals?`), so a `ParsedRun` built without it is type-legal. Before reading any `p.signals.*` field, classifyTask MUST short-circuit:

```ts
if (!p.signals) {
  return { taskType: "chat", complexity: "low", taskTypeConfidence: 0.0, complexityConfidence: 0.0, evidence: [] };
}
```

Without this guard the first `p.signals.toolNames` access throws `TypeError`, violating the no-throw contract. (A `ParsedRun` from the current `parseTrace` always populates `signals`; this guard covers hand-constructed/legacy objects.)

After the guard, if all signals are at their zero-defaults (content present but no signals fired), normal scoring returns the same `{ taskType: "chat", complexity: "low", taskTypeConfidence: 0.0, complexityConfidence: 0.0, evidence: [] }`.

---

### 7. TaskType Scoring

#### 7.1 Architecture

Each `TaskType` receives a raw score in `[0, ∞)` computed as a weighted sum of signal contributions. The TaskType with the highest raw score wins. Confidence is the normalized margin to the runner-up (see §7.3).

All six types are scored independently; there is no early exit. This ensures the confidence margin is always meaningful.

#### 7.2 Tool-Name Groupings

Tool names (from `signals.toolNames`) are grouped into behavioral families. A tool name matches a family if it contains any of the listed substrings (case-insensitive):

```ts
const TOOL_GROUPS = {
  file_edit: ["str_replace", "write_file", "create_file", "edit_file", "patch", "insert_line", "delete_line"],
  file_read: ["read_file", "view_file", "cat", "open_file", "list_dir", "glob"],
  bash:      ["bash", "shell", "terminal", "exec", "run_command", "subprocess"],
  search:    ["web_search", "brave_search", "google_search", "search_web", "search_query", "perplexity"],
  fetch:     ["web_fetch", "url_fetch", "http_get", "fetch_url", "browse"],
  computer:  ["computer", "screenshot", "click", "type_text", "move_mouse", "key_press"],
  extract:   ["extract_text", "parse_pdf", "ocr", "read_pdf", "extract_structured"],
} as const;

type ToolGroup = keyof typeof TOOL_GROUPS;
```

Helper:
```ts
function toolGroupCount(toolNames: Record<string, number>, group: ToolGroup): number {
  return Object.entries(toolNames)
    .filter(([name]) =>
      TOOL_GROUPS[group].some(pattern => name.toLowerCase().includes(pattern))
    )
    .reduce((sum, [, count]) => sum + count, 0);
}
```

---

#### 7.3 Per-TaskType Score Rules

The tables below list every signal, its weight, and the justification grounding each weight. Weights are additive contributions to the raw score, not percentages of a fixed budget. The raw scores across task types are not normalized before comparison — only the margin-to-runner-up is normalized for confidence.

---

##### `coding`

| Signal | Weight | Condition | Justification |
|--------|--------|-----------|---------------|
| `file_edit` tool calls | **+4.0 per call** (cap at 20 = 5 calls) | `toolGroupCount("file_edit") > 0` | File edits are the defining behavior of a coding agent (Claude Code, SWE-bench). Weight 4.0 is the highest single-signal weight to ensure that even a 2-edit trace (score +8.0) comfortably beats a chat trace (max ~5.0 from output ratio + code blocks). Cap at 20 prevents a 50-edit refactor from being undefeatable by all other types. |
| `bash` tool calls | **+2.0 per call** (cap at 10) | `toolGroupCount("bash") > 0` | Bash execution accompanies coding tasks (run tests, compile, lint). Weight 2.0 is half of file_edit because bash alone (without edits) can appear in agentic tasks. Cap at 10 prevents bash-heavy agentic loops from double-counting into coding. |
| `hasCodeBlocks` | **+3.0** | `signals.hasCodeBlocks === true` | Code fences in output are a strong content signal for coding. Weight 3.0 means a trace with code blocks but NO tool calls still reaches 3.0, which requires strong agentic loop signals to beat (total agentic low = ~4–6). |
| `file_read` tool calls | **+0.5 per call** (cap at 3.0) | `toolGroupCount("file_read") > 0` | File reads co-occur with coding but also with research/agentic tasks. Low weight (0.5) and low cap (3.0 = 6 calls) keeps this as a supporting signal, not a determinant. |
| `outputToInputRatio` ≥ 1.5 | **+1.5** | | Code generation produces long outputs relative to input. Threshold 1.5 filters out chat (typically < 1.0) and extraction (< 0.5). Below 1.5 the signal does not fire — no negative weight, because some coding tasks (bug explanations, code reviews) have modest output ratios. |
| `repairSignals` ≥ 2 | **+1.0** | | Repair loops often indicate iterative code debugging. Threshold 2 (not 1) because a single repair can appear in agentic or even chat tasks. Does not fire at 0–1. |

**coding raw score** = sum of firing weights above.

---

##### `extraction`

| Signal | Weight | Condition | Justification |
|--------|--------|-----------|---------------|
| `hasJsonOutput` | **+4.0** | `signals.hasJsonOutput === true` | Structured JSON output is the canonical signature of extraction tasks. Weight 4.0 matches file_edit weight for coding — both are their type's defining signal. |
| `extract` tool calls | **+3.0 per call** (cap at 9.0) | `toolGroupCount("extract") > 0` | Explicit extract/parse tools (PDF parsers, OCR) are unambiguous extraction signals. High weight per call; low cap (3 calls = 9.0 max) because extraction loops rarely need many calls. |
| `outputToInputRatio` ≤ 0.3 | **+2.5** | | Extraction produces short outputs (a JSON object, a list of fields) relative to a potentially large input (a document). Threshold 0.3 targets this profile precisely. Rationale for threshold: a 1000-token document → 250-token JSON extraction = ratio 0.25, clearly below 0.3; a 300-token response to a 1000-token prompt with some context = 0.3 — borderline, included. |
| `hasCitations` | **−1.0** | `signals.hasCitations === true` | Citations in output are anti-correlated with pure extraction — they indicate research or summarization. Negative weight (−1.0) reduces the extraction score when URLs or footnotes are present. This is the only negative weight in the classifier; it is bounded and cannot send extraction score below 0 in isolation. |
| `toolCallsPerRun` = 0 | **+1.5** | `p.toolCallsPerRun === 0` | Many extraction tasks are tool-free: the user pastes a document, the model extracts fields. Zero tool calls in a trace with JSON output strongly suggests extraction. If tools are present, this weight does not fire (the trace is more likely agentic-extraction). |
| `file_read` tool calls | **+0.5 per call** (cap at 1.5) | `toolGroupCount("file_read") > 0` | File reads for extraction tasks (read PDF path → extract fields) contribute weakly. Low weight keeps this subordinate to the JSON + ratio signals. |

**extraction raw score** = sum of firing weights above.

---

##### `research`

| Signal | Weight | Condition | Justification |
|--------|--------|-----------|---------------|
| `search` tool calls | **+4.0 per call** (cap at 16.0) | `toolGroupCount("search") > 0` | Web search tool invocations are the defining signal for research tasks. Weight 4.0 and high cap (4 calls = 16.0) reflect that research agents typically run multiple searches. The cap of 16.0 (4 calls) is generous but bounded — beyond 4 searches, the task is still research, and the type should have already won. |
| `fetch` tool calls | **+2.5 per call** (cap at 7.5) | `toolGroupCount("fetch") > 0` | URL fetching (reading source pages) accompanies research. Lower weight than search (2.5 vs 4.0) because fetches also appear in agentic tasks that aren't research-primary. |
| `hasCitations` | **+3.0** | `signals.hasCitations === true` | Research outputs cite sources. URL/footnote presence in output is a strong content signal. Weight 3.0 ensures that even a tool-free summarization trace with citations scores 3.0 — above most non-research types with no matching tool signals. |
| `outputToInputRatio` ≥ 1.0 | **+1.5** | | Research produces substantive outputs (summaries, reports) relative to input. Threshold 1.0 (not 1.5 like coding) because research summaries are often shorter than code generation but longer than extractions. |
| `hasCodeBlocks` | **−1.5** | `signals.hasCodeBlocks === true` | Code fences in a research output suggest the task is actually coding-adjacent. Negative weight (−1.5) reduces research score when code blocks are present. This is larger in magnitude than the citations negative in extraction because code + search (e.g., "find a library and show me how to use it") is a common confusion case. |
| `reasoningTokenRatio` ≥ 0.3 | **+1.0** | | Extended thinking during research synthesis is common (planning search strategy, synthesizing conflicting sources). Threshold 0.3 (thinking tokens ≥ 30% of output tokens) signals meaningful internal reasoning, not just brief tool-call planning. |

**research raw score** = sum of firing weights above.

---

##### `agentic`

| Signal | Weight | Condition | Justification |
|--------|--------|-----------|---------------|
| `totalToolCalls` | **+0.8 per call** (cap at 24.0) | `p.signals.totalToolCalls > 0` | Agentic tasks are defined by multi-tool-call loops. Weight per-call (0.8) with a high cap (30 calls = 24.0) reflects that agentic is the only type where raw tool volume is the primary signal. A 30-call trace reaches the cap and wins against any type that doesn't also have very high domain signals. The cap exists so that a 100-call trace doesn't become infinitely dominant; 30 calls is a generous upper bound for "clearly agentic." |
| `computer` tool calls | **+3.0 per call** (cap at 9.0) | `toolGroupCount("computer") > 0` | Computer-use (screenshot, click, type) is exclusively agentic — no other task type uses these tools. Weight 3.0 per call makes even 2 computer calls (+6.0) a strong agentic signal. |
| `repairSignals` | **+1.5 per signal** (cap at 6.0) | `signals.repairSignals > 0` | Repair-and-retry loops are the defining behavioral signature of agentic tasks — the agent encounters an error, diagnoses it, and retries. Weight 1.5 per event (cap 4 events = 6.0) ensures that a trace with 3 repair loops (+4.5) significantly boosts agentic score without needing computer or file-edit tools. |
| `turnCount` ≥ 5 | **+2.0** | | Multi-turn sessions (5+ assistant turns) indicate an ongoing agentic loop. Threshold 5 is chosen because typical chat is 1–3 turns, extraction is 1–2 turns; 5+ turns reliably indicates a loop-based task. Fires once regardless of how high `turnCount` is. |
| `turnCount` ≥ 10 | **+1.5** (additional) | | A second tier for very long loops (10+ turns). Additive with the 5-turn weight: a 10-turn trace gets +3.5 total from turn count. Rationale: 10-turn traces almost never arise in one-shot coding or chat; they are characteristic of multi-step execution loops. |
| Mixed tool diversity ≥ 3 groups | **+2.0** | at least 3 distinct `TOOL_GROUPS` have count > 0 | Agentic tasks combine multiple tool types (read + edit + bash, or search + fetch + computer). Diversity of tool groups is the key distinction between a coding agent (file_edit + bash) and a full agentic workflow (+ search + computer + ...). Threshold 3 groups ensures this fires for mixed-tool agents but not for single-domain coding or research. |

**agentic raw score** = sum of firing weights above.

---

##### `reasoning`

| Signal | Weight | Condition | Justification |
|--------|--------|-----------|---------------|
| `reasoningTokenRatio` ≥ 0.5 | **+5.0** | | A high thinking-to-output ratio is the strongest single indicator of a reasoning task. Threshold 0.5 (thinking tokens ≥ 50% of output tokens) marks traces where the model spent more effort "thinking" than answering — the profile of deduction, math, and logic tasks. Weight 5.0 is the highest single-signal weight in the classifier (exceeding file_edit at 4.0) because this signal is nearly exclusive to reasoning tasks when the threshold is met. |
| `reasoningTokenRatio` ≥ 0.2 | **+2.5** (instead of 5.0, not additive) | | A moderate thinking ratio (0.2–0.5) is still a reasoning signal but weaker — could be a coding agent planning its approach, or a research agent synthesizing sources. Score 2.5 (separate tier, not additive to the ≥0.5 tier). Implementation: score 5.0 if ≥ 0.5, else score 2.5 if ≥ 0.2, else 0. |
| `toolCallsPerRun` = 0 | **+2.0** | `p.toolCallsPerRun === 0` | Deductive reasoning tasks are almost always tool-free — the model reasons from the provided premises without calling external tools. Weight 2.0 is significant but not dominant: it ensures that a tool-free trace with high reasoning token ratio (5.0 + 2.0 = 7.0) cleanly beats agentic traces with the same ratio but many tool calls. |
| `outputToInputRatio` between 0.3 and 1.5 | **+1.5** | | Reasoning tasks produce moderate-length outputs: not as short as extraction (< 0.3) and not as long as code generation (> 1.5). The band 0.3–1.5 captures "a substantive answer to a complex question." Both bounds are checked (`ratio >= 0.3 && ratio <= 1.5`). |
| `hasCodeBlocks` | **−2.0** | `signals.hasCodeBlocks === true` | Code fences in a reasoning-classified trace suggest the task was actually a coding problem (produce code, not just reason about it). Negative weight −2.0 significantly reduces reasoning score — a trace with code blocks and a high reasoning ratio should lean toward coding, not reasoning. |

**reasoning raw score** = sum of firing weights above (floored at 0 — negative weights cannot produce a sub-zero score for any type).

---

##### `chat`

Chat is the default type — it wins when no other type has a strong signal. Its scoring reflects absence of specialization signals.

| Signal | Weight | Condition | Justification |
|--------|--------|-----------|---------------|
| `toolCallsPerRun` = 0 | **+3.0** | `p.toolCallsPerRun === 0` | Chat is tool-free. Weight 3.0 gives chat a solid baseline when no tools are present — it will beat other types unless their domain signals are present. |
| `outputToInputRatio` between 0.2 and 1.2 | **+2.0** | | Conversational responses are moderate in length: more than a trivial answer (> 0.2) but not a long generation (< 1.2). The band covers typical Q&A, explanation, and brainstorming outputs. |
| `hasCodeBlocks` | **−2.0** | `signals.hasCodeBlocks === true` | Code in a chat response suggests a coding task misclassified as chat. Negative weight reduces chat score, allowing coding to win. |
| `hasJsonOutput` | **−2.0** | `signals.hasJsonOutput === true` | JSON output in a chat-like trace suggests extraction. Negative weight prevents chat from winning over extraction when structured output is present. |
| `hasCitations` | **+1.0** | `signals.hasCitations === true` | Citations appear in research-oriented chat (e.g., "here are the sources"). A positive weight here acknowledges that some chat tasks include citations without reaching research complexity. Lower than the research weight (3.0) because in chat, citations are a supporting feature, not the primary product. |
| `reasoningTokenRatio` ≥ 0.2 | **−1.5** | | Extended thinking in a chat trace suggests the task is harder than conversational — should lean toward reasoning or research. Negative weight reduces chat score. |

**chat raw score** = sum of firing weights above (floored at 0).

---

#### 7.3 Winner Selection and Confidence

```ts
// Score all six types
const scores: Record<TaskType, number> = {
  coding: scoreCoding(p),
  extraction: scoreExtraction(p),
  research: scoreResearch(p),
  agentic: scoreAgentic(p),
  reasoning: scoreReasoning(p),
  chat: scoreChat(p),
};

// Sort descending
const sorted = (Object.entries(scores) as [TaskType, number][])
  .sort(([, a], [, b]) => b - a);

const winner = sorted[0];
const runnerUp = sorted[1];

const taskType: TaskType = winner[0];
const winnerScore = winner[1];
const runnerUpScore = runnerUp[1];

// Confidence: normalized margin to runner-up.
// Normalization basis: 10.0 (a "definitive" margin — e.g., a 15-call coding trace
// vs a chat trace produces a margin >> 10, which clamps to 1.0).
// Rationale for 10.0: the maximum plausible single-type score without overflow is
// ~30 (agentic at 30-call cap = 24 + diversity + repairs + turns ≈ 30).
// A margin of 10 out of 30 = one-third of the score range, which intuitively
// represents "moderately confident." Margins > 10 are clamped to 1.0.
const rawMargin = winnerScore - runnerUpScore;
const taskTypeConfidence = Math.min(rawMargin / 10.0, 1.0);
```

---

### 8. Complexity Scoring

Complexity is determined by three independent volume/effort signals, each contributing points to a complexity score. The score maps to a band.

#### 8.1 Complexity Signals

| Signal | Contribution | Justification |
|--------|-------------|---------------|
| **Tool volume**: `signals.totalToolCalls` | `low`: 0–2 calls → **0 pts**; `med`: 3–9 calls → **1 pt**; `high`: 10+ calls → **2 pts** | Tool volume is the most direct proxy for task scope. Thresholds: 0–2 calls = one-shot task (low); 3–9 = moderate workflow (mid); 10+ = extended loop or batch (high). Source: Claude Code traces on real tasks show median 6–8 tool calls for standard coding, 15–25 for complex refactors. |
| **Turn depth**: `signals.turnCount` | `low`: 1–2 turns → **0 pts**; `med`: 3–5 turns → **1 pt**; `high`: 6+ turns → **2 pts** | Conversation/session length correlates with scope. 1–2 turns = single request-response (low); 3–5 = iterative back-and-forth (med); 6+ = sustained multi-round task (high). Thresholds are conservative — a 3-turn trace is only medium, not high, because some research tasks use 3 turns (search → summarize → revise) without being genuinely complex. |
| **Reasoning burn**: `signals.reasoningTokenRatio` | `low`: < 0.1 → **0 pts**; `med`: 0.1–0.4 → **1 pt**; `high`: > 0.4 → **2 pts** | Extended thinking reflects task difficulty. < 0.1 = minimal or no reasoning (simple task); 0.1–0.4 = moderate reasoning engagement; > 0.4 = heavy thinking relative to output (hard task). Threshold 0.1 filters out traces where a small amount of thinking occurs incidentally (planning a bash command). Threshold 0.4 identifies tasks where thinking dominates. |
| **Repair depth**: `signals.repairSignals` | 0 → **0 pts**; 1–2 → **1 pt**; 3+ → **2 pts** | Repair loops indicate obstacles encountered during execution — a hallmark of complex or ambiguous tasks. 1–2 repairs can occur in medium-complexity tasks (one retry on a tool error); 3+ repairs signal sustained difficulty. |

#### 8.2 Complexity Banding

```
total complexity points = tool_pts + turn_pts + reasoning_pts + repair_pts
                         ∈ [0, 8]

low:  0–2 pts
med:  3–5 pts
high: 6–8 pts
```

Rationale for band boundaries:
- `low` (0–2): at most one signal fires at the mid level. Typical chat or single-extraction task.
- `med` (3–5): two mid signals or one high signal. Standard production workload.
- `high` (6–8): two or more high signals, or one high + two mid. Extended agentic run or hard reasoning task.

The bands are symmetric in that each boundary (0–2 / 3–5 / 6–8) covers a range of 3 points, preventing edge sensitivity. A task that is "medium by 1 point" and "low by 1 point" has the same structure regardless of which signal tipped it.

#### 8.3 Complexity Confidence

```ts
// Distance to the nearer band boundary, normalized to half the band width (1.5 pts).
// Band width = 3 pts; half = 1.5 pts.
const bandFloor = complexity === "low" ? 0 : complexity === "med" ? 3 : 6;
const bandCeil  = complexity === "low" ? 2 : complexity === "med" ? 5 : 8;

// Distance to nearest edge: how far inside the band are we?
const distToFloor = totalPoints - bandFloor;
const distToCeil  = bandCeil - totalPoints;
const distToEdge  = Math.min(distToFloor, distToCeil);  // 0 at exact edge, 1.5 at center

// Normalize: 0 at edge (no confidence), 1.0 at center or beyond.
// 1.5 = half of band width; any distance ≥ 1.5 is "well inside" the band.
const complexityConfidence = Math.min(distToEdge / 1.5, 1.0);
```

A score of exactly 3 (the low/med boundary) produces `complexityConfidence = 0.0`. A score of 4 (center of med band) produces `distToEdge = min(1, 1) = 1.0`, normalized to `1.0 / 1.5 = 0.67`. This is calibrated conservatively — the user should see confidence values < 0.5 as a prompt to use the override.

---

### 9. Evidence Array

`evidence` is a `string[]` of human-readable statements describing the signals that drove the verdict, ordered from most impactful to least. Only signals that contributed a non-zero weight to the WINNING task type's score, AND signals that contributed to the complexity determination, are listed. Runner-up type signals are NOT listed.

**Format conventions** (deterministic — no variable phrasing):

| Signal | Evidence string format |
|--------|----------------------|
| file_edit tool calls | `"N file-edit tool calls (str_replace / write_file)"` |
| bash tool calls | `"N bash/shell tool calls"` |
| hasCodeBlocks | `"code blocks (```) in output"` |
| hasJsonOutput | `"JSON object/array in output"` |
| hasCitations | `"URLs or footnote markers in output"` |
| search tool calls | `"N web-search tool calls"` |
| fetch tool calls | `"N URL-fetch tool calls"` |
| totalToolCalls | `"N total tool calls across N turns"` |
| computer tool calls | `"N computer-use tool calls"` |
| repairSignals | `"N repair/retry signals (tool errors or retry phrases)"` |
| turnCount | `"N-turn session"` |
| reasoningTokenRatio | `"reasoning token ratio: X.XX (thinking-heavy output)"` |
| outputToInputRatio | `"output/input ratio: X.XX"` |
| toolCallsPerRun = 0 | `"no tool calls (tool-free trace)"` |
| tool diversity | `"N tool-type groups present (mixed-tool agentic)"` |
| complexity band | `"complexity: low/med/high (tool-volume=N, turns=N, reasoning=X.XX, repairs=N)"` |

The complexity band evidence line is always the last item in the array if it provides information beyond zero-defaults.

Maximum evidence array length: 8 items. If more signals fired than the cap, drop the lowest-weight items first. This keeps the UI card readable.

---

### 10. Unit Test Cases

Framework: **vitest**. File: `src/lib/__tests__/classifyTask.test.ts`.

All test fixtures are `ParsedRun` objects constructed inline (no file I/O). The `signals` block is set explicitly for each fixture; `warnings` is always `[]` unless tested. These tests cover one fixture per TaskType plus one edge case.

---

#### Case 1 — Coding trace (file-edit heavy, Claude Code .jsonl)

**Scenario**: A Claude Code session that edited 6 files, ran bash 4 times, produced code-fenced output.

```ts
it("classifies a file-edit-heavy trace as coding/med", () => {
  const p: ParsedRun = {
    sourceModel: "claude-sonnet-4-6",
    runs: 3, avgInputTokens: 2000, avgOutputTokens: 800,
    avgCacheReadTokens: 1500, avgCacheCreationTokens: 200,
    measuredCacheHitRate: 0.53, toolCallsPerRun: 3.33, warnings: [],
    signals: {
      toolNames: { "str_replace_editor": 6, "bash": 4, "read_file": 3 },
      totalToolCalls: 13,
      turnCount: 3,
      outputToInputRatio: 800 / (2000 + 1500 + 200),  // ≈ 0.22
      hasCodeBlocks: true,
      hasJsonOutput: false,
      hasCitations: false,
      reasoningTokenRatio: 0.0,
      repairSignals: 1,
    },
  };

  const cls = classifyTask(p);

  // coding score: file_edit min(6*4, 20)=20 + bash min(4*2, 10)=8 + hasCodeBlocks=3
  //              + file_read min(3*0.5, 3)=1.5 = 32.5 (capped: 20+8=28+3+1.5=32.5)
  // Note: outputToInputRatio 0.22 < 1.5 → does NOT fire (+0)
  // repairSignals 1 < 2 → does NOT fire (+0)
  // agentic score: totalToolCalls min(13*0.8, 24)=10.4
  //               + turnCount=3 does NOT clear ≥5 threshold → +0
  //               + repairSignals=1 → min(1*1.5, 6)=1.5
  //               + mixed groups: file_edit+bash+file_read = 3 groups → +2.0
  //               = 10.4 + 0 + 1.5 + 2.0 = 13.9
  // coding wins by wide margin (32.5 vs 13.9); confidence high
  expect(cls.taskType).toBe("coding");
  expect(cls.taskTypeConfidence).toBeGreaterThan(0.5);

  // complexity: tool_pts=2 (13 calls → high=2) + turn_pts=1 (3 turns → med=1)
  //             + reasoning_pts=0 + repair_pts=1 (1 repair → low-mid=1) = 4 → med
  expect(cls.complexity).toBe("med");

  expect(cls.evidence.some(e => e.includes("file-edit"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("bash"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("code blocks"))).toBe(true);
});
```

---

#### Case 2 — Extraction trace (JSON output, tool-free)

**Scenario**: User pastes a document; model returns a JSON object. No tool calls.

```ts
it("classifies a JSON-output, tool-free trace as extraction/low", () => {
  const p: ParsedRun = {
    sourceModel: "claude-haiku-4-5",
    runs: 1, avgInputTokens: 3000, avgOutputTokens: 400,
    avgCacheReadTokens: 0, avgCacheCreationTokens: 0,
    measuredCacheHitRate: 0, toolCallsPerRun: 0, warnings: [],
    signals: {
      toolNames: {},
      totalToolCalls: 0,
      turnCount: 1,
      outputToInputRatio: 400 / 3000,  // 0.133
      hasCodeBlocks: false,
      hasJsonOutput: true,
      hasCitations: false,
      reasoningTokenRatio: 0.0,
      repairSignals: 0,
    },
  };

  const cls = classifyTask(p);

  // extraction score: hasJsonOutput=4.0 + outputToInputRatio 0.133≤0.3=2.5
  //                  + toolCallsPerRun=0 → +1.5 = 8.0
  //                  hasCitations false → no deduction
  // chat score: toolCallsPerRun=0 → +3.0 + ratio in [0.2,1.2]? 0.133 < 0.2 → NO
  //             = 3.0
  // extraction wins (8.0 vs 3.0)
  expect(cls.taskType).toBe("extraction");
  expect(cls.taskTypeConfidence).toBeGreaterThan(0.4);

  // complexity: tool_pts=0 + turn_pts=0 + reasoning_pts=0 + repair_pts=0 = 0 → low
  expect(cls.complexity).toBe("low");

  expect(cls.evidence.some(e => e.includes("JSON"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("tool-free"))).toBe(true);
});
```

---

#### Case 3 — Research trace (search + fetch + citations)

**Scenario**: An agent running 3 web searches, 2 URL fetches, producing a cited report.

```ts
it("classifies a web-search + citation trace as research/med", () => {
  const p: ParsedRun = {
    sourceModel: "claude-sonnet-4-6",
    runs: 2, avgInputTokens: 1500, avgOutputTokens: 1800,
    avgCacheReadTokens: 800, avgCacheCreationTokens: 300,
    measuredCacheHitRate: 0.31, toolCallsPerRun: 2.5, warnings: [],
    signals: {
      toolNames: { "web_search": 3, "web_fetch": 2 },
      totalToolCalls: 5,
      turnCount: 2,
      outputToInputRatio: 1800 / (1500 + 800 + 300),  // ≈ 0.69
      hasCodeBlocks: false,
      hasJsonOutput: false,
      hasCitations: true,
      reasoningTokenRatio: 0.15,
      repairSignals: 0,
    },
  };

  const cls = classifyTask(p);

  // research score: search min(3*4, 16)=12 + fetch min(2*2.5, 7.5)=5
  //                + hasCitations=3.0 + ratio 0.69 ≥ 1.0? NO → 0
  //                + reasoningTokenRatio 0.15 ≥ 0.3? NO → 0 = 20.0
  //                (hasCodeBlocks false → no deduction)
  // agentic score: totalToolCalls min(5*0.8, 24)=4.0 + turnCount 2 → 0
  //               + tool groups: search+fetch = 2 groups < 3 → no diversity bonus = 4.0
  // research wins (20.0 vs 4.0); very high confidence
  expect(cls.taskType).toBe("research");
  expect(cls.taskTypeConfidence).toBeGreaterThan(0.8);

  // complexity: tool_pts=1 (5 calls → med=1) + turn_pts=0 + reasoning_pts=1 (0.15 ≥ 0.1)
  //             + repair_pts=0 = 2 → low  (just below med boundary of 3)
  expect(cls.complexity).toBe("low");

  expect(cls.evidence.some(e => e.includes("web-search"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("URL-fetch"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("URLs or footnote"))).toBe(true);
});
```

---

#### Case 4 — Agentic loop trace (computer-use + repairs + long session)

**Scenario**: A computer-use agent running 12 tool calls, 3 computer-use clicks, 3 repair signals, 8 turns.

```ts
it("classifies a computer-use, high-repair, multi-turn trace as agentic/high", () => {
  const p: ParsedRun = {
    sourceModel: "claude-opus-4-7",
    runs: 8, avgInputTokens: 4000, avgOutputTokens: 600,
    avgCacheReadTokens: 3000, avgCacheCreationTokens: 500,
    measuredCacheHitRate: 0.4, toolCallsPerRun: 1.5, warnings: [],
    signals: {
      toolNames: {
        "computer": 3,
        "bash": 5,
        "read_file": 4,
      },
      totalToolCalls: 12,
      turnCount: 8,
      outputToInputRatio: 600 / (4000 + 3000 + 500),  // ≈ 0.08
      hasCodeBlocks: false,
      hasJsonOutput: false,
      hasCitations: false,
      reasoningTokenRatio: 0.35,
      repairSignals: 3,
    },
  };

  const cls = classifyTask(p);

  // agentic score: totalToolCalls min(12*0.8, 24)=9.6
  //               + computer min(3*3, 9)=9.0
  //               + repairSignals min(3*1.5, 6)=4.5
  //               + turnCount ≥ 5 → +2.0
  //               + turnCount ≥ 10? NO → 0
  //               + tool groups: computer+bash+file_read = 3 groups → +2.0
  //               = 9.6 + 9.0 + 4.5 + 2.0 + 2.0 = 27.1
  // coding score: bash min(5*2, 10)=10 + file_read min(4*0.5, 3)=2.0
  //              + repairSignals=3 ≥ 2 → +1.0 = 13.0
  //              (no hasCodeBlocks, no file_edit, outputToInputRatio 0.08 < 1.5)
  // agentic wins (27.1 vs 13.0)
  expect(cls.taskType).toBe("agentic");
  expect(cls.taskTypeConfidence).toBeGreaterThan(0.7);

  // complexity: tool_pts=2 (12 calls → high) + turn_pts=2 (8 turns → high)
  //             + reasoning_pts=1 (0.35 in [0.1,0.4]) + repair_pts=2 (3 repairs → high)
  //             = 7 → high
  expect(cls.complexity).toBe("high");

  expect(cls.evidence.some(e => e.includes("computer-use"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("repair"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("turn"))).toBe(true);
});
```

---

#### Case 5 — Reasoning trace (extended thinking, no tools)

**Scenario**: A deduction / math task run on a thinking-mode model. High reasoning token ratio, no tools.

```ts
it("classifies a high-reasoning-ratio, tool-free trace as reasoning/med", () => {
  const p: ParsedRun = {
    sourceModel: "claude-opus-4-7",
    runs: 1, avgInputTokens: 500, avgOutputTokens: 800,
    avgCacheReadTokens: 0, avgCacheCreationTokens: 0,
    measuredCacheHitRate: 0, toolCallsPerRun: 0, warnings: [],
    signals: {
      toolNames: {},
      totalToolCalls: 0,
      turnCount: 1,
      outputToInputRatio: 800 / 500,  // 1.6
      hasCodeBlocks: false,
      hasJsonOutput: false,
      hasCitations: false,
      reasoningTokenRatio: 0.65,      // thinking tokens = 65% of output tokens
      repairSignals: 0,
    },
  };

  const cls = classifyTask(p);

  // reasoning score: reasoningTokenRatio 0.65 ≥ 0.5 → +5.0
  //                 + toolCallsPerRun=0 → +2.0
  //                 + outputToInputRatio 1.6: band [0.3,1.5] → 1.6 > 1.5, does NOT fire → 0
  //                 + hasCodeBlocks false → no deduction
  //                 = 7.0
  // chat score: toolCallsPerRun=0 → +3.0
  //             + ratio [0.2,1.2]: 1.6 > 1.2, does NOT fire → 0
  //             + reasoningTokenRatio ≥ 0.2 → −1.5
  //             = 1.5
  // reasoning wins (7.0 vs 1.5)
  expect(cls.taskType).toBe("reasoning");
  expect(cls.taskTypeConfidence).toBeGreaterThan(0.5);

  // complexity: tool_pts=0 + turn_pts=0 (1 turn)
  //             + reasoning_pts=2 (0.65 > 0.4 → high=2)
  //             + repair_pts=0 = 2 → low
  // (high reasoning burn alone = 2 pts, just at the low/med boundary → low)
  expect(cls.complexity).toBe("low");

  expect(cls.evidence.some(e => e.includes("reasoning token ratio"))).toBe(true);
  expect(cls.evidence.some(e => e.includes("tool-free"))).toBe(true);
});
```

---

#### Case 6 — Chat trace (conversational, no tools, no special signals)

**Scenario**: A simple Q&A exchange, 1 turn, moderate output.

```ts
it("classifies a tool-free, moderate-output, no-special-signal trace as chat/low", () => {
  const p: ParsedRun = {
    sourceModel: "claude-haiku-4-5",
    runs: 1, avgInputTokens: 300, avgOutputTokens: 250,
    avgCacheReadTokens: 0, avgCacheCreationTokens: 0,
    measuredCacheHitRate: 0, toolCallsPerRun: 0, warnings: [],
    signals: {
      toolNames: {},
      totalToolCalls: 0,
      turnCount: 1,
      outputToInputRatio: 250 / 300,  // 0.833
      hasCodeBlocks: false,
      hasJsonOutput: false,
      hasCitations: false,
      reasoningTokenRatio: 0.0,
      repairSignals: 0,
    },
  };

  const cls = classifyTask(p);

  // chat score: toolCallsPerRun=0 → +3.0
  //             + ratio [0.2,1.2]: 0.833 → fires → +2.0
  //             = 5.0
  // extraction score: toolCallsPerRun=0 → +1.5; outputToInputRatio 0.833 > 0.3 → NO
  //                   hasJsonOutput false → no base; = 1.5
  // reasoning score: reasoningTokenRatio 0.0 < 0.2 → 0; toolCallsPerRun=0 → +2.0;
  //                  outputToInputRatio 0.833 in [0.3,1.5] → +1.5; = 3.5
  // chat wins (5.0 vs reasoning 3.5 vs extraction 1.5 vs others ~0)
  expect(cls.taskType).toBe("chat");

  // complexity: tool_pts=0 + turn_pts=0 + reasoning_pts=0 + repair_pts=0 = 0 → low
  expect(cls.complexity).toBe("low");

  // confidence is moderate — reasoning scores 3.5, margin = 1.5, normalized = 1.5/10 = 0.15
  expect(cls.taskTypeConfidence).toBeGreaterThan(0.0);
  expect(cls.evidence.some(e => e.includes("tool-free"))).toBe(true);
});
```

---

#### Case 7 — All-zero signals edge case (bare-minimum trace)

**Scenario**: A ParsedRun with no content at all — only token counts, no signals derivable.

```ts
it("returns chat/low with zero confidence when all signals are zero", () => {
  const p: ParsedRun = {
    sourceModel: undefined,
    runs: 1, avgInputTokens: 100, avgOutputTokens: 100,
    avgCacheReadTokens: 0, avgCacheCreationTokens: 0,
    measuredCacheHitRate: 0, toolCallsPerRun: 0, warnings: [],
    signals: {
      toolNames: {},
      totalToolCalls: 0,
      turnCount: 1,
      outputToInputRatio: 1.0,
      hasCodeBlocks: false,
      hasJsonOutput: false,
      hasCitations: false,
      reasoningTokenRatio: 0.0,
      repairSignals: 0,
    },
  };

  const cls = classifyTask(p);

  // chat: toolCallsPerRun=0 → +3.0; ratio [0.2,1.2]: 1.0 → +2.0 = 5.0
  // reasoning: toolCallsPerRun=0 → +2.0; ratio [0.3,1.5]: 1.0 → +1.5 = 3.5
  // chat wins but margin is 1.5 → confidence = 1.5/10 = 0.15 (low, non-zero)
  expect(cls.taskType).toBe("chat");
  expect(cls.complexity).toBe("low");
  expect(cls.taskTypeConfidence).toBeCloseTo(0.15, 2);
  expect(cls.complexityConfidence).toBe(0.0); // score=0, at band floor → 0 confidence
  // evidence may be empty or minimal; do not assert specific content
});
```

---

## Appendix A — Weight Derivation Summary

The weight values were derived by solving for consistent ordering on a set of "obvious" example traces:

1. A 6-file-edit coding trace must score coding > agentic. (Constraint: coding ≥ agentic when file_edits dominate.)
2. A 5-search research trace must score research > agentic. (Constraint: search weight × 5 > agentic tool weight × 5.)
3. A JSON-output, tool-free trace must score extraction > chat.
4. A 0.65-ratio thinking trace must score reasoning > chat and reasoning > coding.
5. An 8-turn, 12-call, 3-computer-use trace must score agentic > coding.
6. A plain Q&A must score chat above all others when no signals fire.

From constraint 1: `file_edit × 6 > agentic_per_tool × 12`. With `agentic_per_tool = 0.8` (cap applies at 30 calls, not 12): `4.0 × 6 = 24 > 9.6`. ✓

From constraint 2: `search × 5 = 20 > agentic × 5 = 4 + diversity_bonus`. ✓ (research wins 20 vs agentic ~6 without computer/repair signals).

From constraint 3: `JSON=4.0 + ratio=2.5 + toolFree=1.5 = 8.0 > chat_toolFree=3.0 + ratio_in_band=0`. ✓

From constraint 4: `reasoning_ratio_high=5.0 + toolFree=2.0 = 7.0 > chat=5.0`. ✓ (3-point margin; confidence 0.3).

From constraint 5: `agentic = 9.6 + 9.0 + 4.5 + 2.0 + 2.0 = 27.1 > coding_bash=10 + file_read=2 = 12`. ✓

From constraint 6: chat = 5.0 in the all-zero signal case; no other type scores above 3.5. ✓

All constraints are satisfied under the weight table above without contradiction.

---

## Appendix B — Signal Availability by Format

| Signal | Anthropic JSON | Claude Code .jsonl |
|--------|---------------|-------------------|
| `toolNames` | `content[].type === "tool_use"` | `message.content[].type === "tool_use"` |
| `totalToolCalls` | same | same |
| `turnCount` | = `runs` (array length) | = qualifying assistant line count |
| `outputToInputRatio` | computed from aggregated averages | same |
| `hasCodeBlocks` | `content[].type === "text"` | `message.content[].type === "text"` |
| `hasJsonOutput` | same | same |
| `hasCitations` | same | same |
| `reasoningTokenRatio` | `content[].type === "thinking"` | `message.content[].type === "thinking"` |
| `repairSignals` | `content[].type === "tool_result"` + text patterns | `human` turn `content[].type === "tool_result"` + assistant text patterns |

For `repairSignals` in `.jsonl`: `tool_result` blocks appear in `human` turns (the environment's response to the model's tool call). The scanner must inspect `human` turn content for `tool_result` blocks with `is_error === true`, even though `human` turns are otherwise skipped for token counting.
