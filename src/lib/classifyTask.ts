// C2 — Task classifier. Implements SPEC-task-classifier.md §6–§9.
// Pure synchronous TypeScript. No DOM, no async, no API calls, no ML model.
// Deterministic: every weight/threshold is cited to the spec. Does not throw.

import type { ParsedRun } from "./parseTrace";

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
  taskTypeConfidence: number; // [0,1] — normalized margin to runner-up
  complexity: Complexity;
  complexityConfidence: number; // [0,1] — normalized distance to nearer band edge
  evidence: string[]; // human-readable firing signals, score-descending
};

type Signals = NonNullable<ParsedRun["signals"]>;

// §7.2 — tool-name behavioral families (substring match, case-insensitive).
const TOOL_GROUPS = {
  file_edit: ["str_replace", "write_file", "create_file", "edit_file", "patch", "insert_line", "delete_line"],
  file_read: ["read_file", "view_file", "cat", "open_file", "list_dir", "glob"],
  bash: ["bash", "shell", "terminal", "exec", "run_command", "subprocess"],
  search: ["web_search", "brave_search", "google_search", "search_web", "search_query", "perplexity"],
  fetch: ["web_fetch", "url_fetch", "http_get", "fetch_url", "browse"],
  computer: ["computer", "screenshot", "click", "type_text", "move_mouse", "key_press"],
  extract: ["extract_text", "parse_pdf", "ocr", "read_pdf", "extract_structured"],
} as const;

type ToolGroup = keyof typeof TOOL_GROUPS;

function toolGroupCount(toolNames: Record<string, number>, group: ToolGroup): number {
  return Object.entries(toolNames)
    .filter(([name]) =>
      TOOL_GROUPS[group].some((pattern) => name.toLowerCase().includes(pattern)),
    )
    .reduce((sum, [, count]) => sum + count, 0);
}

function distinctToolGroups(toolNames: Record<string, number>): number {
  let n = 0;
  for (const g of Object.keys(TOOL_GROUPS) as ToolGroup[]) {
    if (toolGroupCount(toolNames, g) > 0) n += 1;
  }
  return n;
}

// An evidence-tracking score contribution: each firing weight records a string.
type Contribution = { weight: number; evidence?: string };

// ── Per-TaskType scorers (§7.3). Each returns raw score + firing evidence. ──

type ScoreResult = { score: number; evidence: string[] };

function sumContributions(contribs: Contribution[]): ScoreResult {
  let score = 0;
  const evidence: string[] = [];
  // Preserve order of firing by weight magnitude (descending) for evidence.
  const fired = contribs.filter((c) => c.weight !== 0);
  for (const c of fired) score += c.weight;
  // Floor negative-only types at 0 is handled by callers; here just sum.
  const sorted = [...fired].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  for (const c of sorted) if (c.evidence) evidence.push(c.evidence);
  return { score, evidence };
}

function scoreCoding(p: ParsedRun, s: Signals): ScoreResult {
  const fileEdit = toolGroupCount(s.toolNames, "file_edit");
  const bash = toolGroupCount(s.toolNames, "bash");
  const fileRead = toolGroupCount(s.toolNames, "file_read");
  const contribs: Contribution[] = [
    {
      weight: fileEdit > 0 ? Math.min(fileEdit * 4.0, 20) : 0,
      evidence: fileEdit > 0 ? `${fileEdit} file-edit tool calls (str_replace / write_file)` : undefined,
    },
    {
      weight: bash > 0 ? Math.min(bash * 2.0, 10) : 0,
      evidence: bash > 0 ? `${bash} bash/shell tool calls` : undefined,
    },
    {
      weight: s.hasCodeBlocks ? 3.0 : 0,
      evidence: s.hasCodeBlocks ? "code blocks (```) in output" : undefined,
    },
    {
      weight: fileRead > 0 ? Math.min(fileRead * 0.5, 3.0) : 0,
      // file_read evidence is shared across types; emit a generic note for coding.
      evidence: undefined,
    },
    { weight: s.outputToInputRatio >= 1.5 ? 1.5 : 0, evidence: undefined },
    { weight: s.repairSignals >= 2 ? 1.0 : 0, evidence: undefined },
  ];
  return sumContributions(contribs);
}

function scoreExtraction(p: ParsedRun, s: Signals): ScoreResult {
  const extract = toolGroupCount(s.toolNames, "extract");
  const fileRead = toolGroupCount(s.toolNames, "file_read");
  const contribs: Contribution[] = [
    {
      weight: s.hasJsonOutput ? 4.0 : 0,
      evidence: s.hasJsonOutput ? "JSON object/array in output" : undefined,
    },
    {
      weight: extract > 0 ? Math.min(extract * 3.0, 9.0) : 0,
      evidence: extract > 0 ? `${extract} extract/parse tool calls` : undefined,
    },
    {
      weight: s.outputToInputRatio <= 0.3 ? 2.5 : 0,
      evidence: undefined,
    },
    { weight: s.hasCitations ? -1.0 : 0, evidence: undefined },
    {
      weight: p.toolCallsPerRun === 0 ? 1.5 : 0,
      evidence: p.toolCallsPerRun === 0 ? "no tool calls (tool-free trace)" : undefined,
    },
    { weight: fileRead > 0 ? Math.min(fileRead * 0.5, 1.5) : 0, evidence: undefined },
  ];
  return sumContributions(contribs);
}

function scoreResearch(p: ParsedRun, s: Signals): ScoreResult {
  const search = toolGroupCount(s.toolNames, "search");
  const fetch = toolGroupCount(s.toolNames, "fetch");
  const contribs: Contribution[] = [
    {
      weight: search > 0 ? Math.min(search * 4.0, 16.0) : 0,
      evidence: search > 0 ? `${search} web-search tool calls` : undefined,
    },
    {
      weight: fetch > 0 ? Math.min(fetch * 2.5, 7.5) : 0,
      evidence: fetch > 0 ? `${fetch} URL-fetch tool calls` : undefined,
    },
    {
      weight: s.hasCitations ? 3.0 : 0,
      evidence: s.hasCitations ? "URLs or footnote markers in output" : undefined,
    },
    { weight: s.outputToInputRatio >= 1.0 ? 1.5 : 0, evidence: undefined },
    { weight: s.hasCodeBlocks ? -1.5 : 0, evidence: undefined },
    { weight: s.reasoningTokenRatio >= 0.3 ? 1.0 : 0, evidence: undefined },
  ];
  return sumContributions(contribs);
}

function scoreAgentic(p: ParsedRun, s: Signals): ScoreResult {
  const computer = toolGroupCount(s.toolNames, "computer");
  const diversity = distinctToolGroups(s.toolNames);
  const contribs: Contribution[] = [
    {
      weight: s.totalToolCalls > 0 ? Math.min(s.totalToolCalls * 0.8, 24.0) : 0,
      evidence:
        s.totalToolCalls > 0
          ? `${s.totalToolCalls} total tool calls across ${s.turnCount} turns`
          : undefined,
    },
    {
      weight: computer > 0 ? Math.min(computer * 3.0, 9.0) : 0,
      evidence: computer > 0 ? `${computer} computer-use tool calls` : undefined,
    },
    {
      weight: s.repairSignals > 0 ? Math.min(s.repairSignals * 1.5, 6.0) : 0,
      evidence:
        s.repairSignals > 0
          ? `${s.repairSignals} repair/retry signals (tool errors or retry phrases)`
          : undefined,
    },
    {
      weight: s.turnCount >= 5 ? 2.0 : 0,
      evidence: s.turnCount >= 5 ? `${s.turnCount}-turn session` : undefined,
    },
    { weight: s.turnCount >= 10 ? 1.5 : 0, evidence: undefined },
    {
      weight: diversity >= 3 ? 2.0 : 0,
      evidence: diversity >= 3 ? `${diversity} tool-type groups present (mixed-tool agentic)` : undefined,
    },
  ];
  return sumContributions(contribs);
}

function scoreReasoning(p: ParsedRun, s: Signals): ScoreResult {
  // Tiered reasoning-ratio weight (§7.3 reasoning): 5.0 if ≥0.5, else 2.5 if ≥0.2.
  let ratioWeight = 0;
  if (s.reasoningTokenRatio >= 0.5) ratioWeight = 5.0;
  else if (s.reasoningTokenRatio >= 0.2) ratioWeight = 2.5;

  const contribs: Contribution[] = [
    {
      weight: ratioWeight,
      evidence:
        ratioWeight > 0
          ? `reasoning token ratio: ${s.reasoningTokenRatio.toFixed(2)} (thinking-heavy output)`
          : undefined,
    },
    {
      weight: p.toolCallsPerRun === 0 ? 2.0 : 0,
      evidence: p.toolCallsPerRun === 0 ? "no tool calls (tool-free trace)" : undefined,
    },
    {
      weight: s.outputToInputRatio >= 0.3 && s.outputToInputRatio <= 1.5 ? 1.5 : 0,
      evidence: undefined,
    },
    { weight: s.hasCodeBlocks ? -2.0 : 0, evidence: undefined },
  ];
  const res = sumContributions(contribs);
  res.score = Math.max(res.score, 0); // floor at 0 (§7.3 reasoning)
  return res;
}

function scoreChat(p: ParsedRun, s: Signals): ScoreResult {
  const contribs: Contribution[] = [
    {
      weight: p.toolCallsPerRun === 0 ? 3.0 : 0,
      evidence: p.toolCallsPerRun === 0 ? "no tool calls (tool-free trace)" : undefined,
    },
    {
      weight: s.outputToInputRatio >= 0.2 && s.outputToInputRatio <= 1.2 ? 2.0 : 0,
      evidence: undefined,
    },
    { weight: s.hasCodeBlocks ? -2.0 : 0, evidence: undefined },
    { weight: s.hasJsonOutput ? -2.0 : 0, evidence: undefined },
    {
      weight: s.hasCitations ? 1.0 : 0,
      evidence: s.hasCitations ? "URLs or footnote markers in output" : undefined,
    },
    { weight: s.reasoningTokenRatio >= 0.2 ? -1.5 : 0, evidence: undefined },
  ];
  const res = sumContributions(contribs);
  res.score = Math.max(res.score, 0); // floor at 0 (§7.3 chat)
  return res;
}

// ── Complexity scoring (§8) ──

function complexityPoints(s: Signals): {
  total: number;
  toolPts: number;
  turnPts: number;
  reasoningPts: number;
  repairPts: number;
} {
  // Tool volume (§8.1)
  const toolPts = s.totalToolCalls >= 10 ? 2 : s.totalToolCalls >= 3 ? 1 : 0;
  // Turn depth (§8.1)
  const turnPts = s.turnCount >= 6 ? 2 : s.turnCount >= 3 ? 1 : 0;
  // Reasoning burn (§8.1)
  const reasoningPts =
    s.reasoningTokenRatio > 0.4 ? 2 : s.reasoningTokenRatio >= 0.1 ? 1 : 0;
  // Repair depth (§8.1)
  const repairPts = s.repairSignals >= 3 ? 2 : s.repairSignals >= 1 ? 1 : 0;

  return {
    total: toolPts + turnPts + reasoningPts + repairPts,
    toolPts,
    turnPts,
    reasoningPts,
    repairPts,
  };
}

function bandComplexity(total: number): Complexity {
  if (total <= 2) return "low";
  if (total <= 5) return "med";
  return "high";
}

function complexityConfidenceOf(complexity: Complexity, total: number): number {
  const bandFloor = complexity === "low" ? 0 : complexity === "med" ? 3 : 6;
  const bandCeil = complexity === "low" ? 2 : complexity === "med" ? 5 : 8;
  const distToFloor = total - bandFloor;
  const distToCeil = bandCeil - total;
  const distToEdge = Math.min(distToFloor, distToCeil);
  return Math.min(distToEdge / 1.5, 1.0);
}

// ── Main entry (§7.3 winner selection, §9 evidence) ──

export function classifyTask(p: ParsedRun): Classification {
  // §6 guard — undefined signals: short-circuit (no-throw contract).
  if (!p.signals) {
    return {
      taskType: "chat",
      complexity: "low",
      taskTypeConfidence: 0.0,
      complexityConfidence: 0.0,
      evidence: [],
    };
  }

  const s = p.signals;

  const results: Record<TaskType, ScoreResult> = {
    coding: scoreCoding(p, s),
    extraction: scoreExtraction(p, s),
    research: scoreResearch(p, s),
    agentic: scoreAgentic(p, s),
    reasoning: scoreReasoning(p, s),
    chat: scoreChat(p, s),
  };

  const sorted = (Object.entries(results) as [TaskType, ScoreResult][]).sort(
    ([, a], [, b]) => b.score - a.score,
  );

  const winner = sorted[0];
  const runnerUp = sorted[1];
  const taskType = winner[0];
  const rawMargin = winner[1].score - runnerUp[1].score;
  const taskTypeConfidence = Math.min(rawMargin / 10.0, 1.0);

  // Complexity (§8)
  const cp = complexityPoints(s);
  const complexity = bandComplexity(cp.total);
  const complexityConfidence = complexityConfidenceOf(complexity, cp.total);

  // §9 — evidence: winning type's firing signals (score-descending) + complexity line.
  const evidence: string[] = [...winner[1].evidence];

  // Complexity band evidence is always last if it carries info beyond zero-defaults.
  const complexityLine = `complexity: ${complexity} (tool-volume=${s.totalToolCalls}, turns=${s.turnCount}, reasoning=${s.reasoningTokenRatio.toFixed(2)}, repairs=${s.repairSignals})`;
  const hasInfo =
    s.totalToolCalls > 0 ||
    s.turnCount > 1 ||
    s.reasoningTokenRatio > 0 ||
    s.repairSignals > 0;
  if (hasInfo) evidence.push(complexityLine);

  // Cap at 8 items (§9): drop lowest-weight first. Winner evidence is already
  // weight-descending; the complexity line is appended last, so slicing keeps
  // the highest-weight items + the complexity line if room remains.
  let capped = evidence;
  if (capped.length > 8) {
    if (hasInfo) {
      // keep top-7 weighted + complexity line
      capped = [...evidence.slice(0, 7), complexityLine];
    } else {
      capped = evidence.slice(0, 8);
    }
  }

  return {
    taskType,
    taskTypeConfidence,
    complexity,
    complexityConfidence,
    evidence: capped,
  };
}
