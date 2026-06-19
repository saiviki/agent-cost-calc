// S2 — Trace parser. Implements SPEC-trace-parser.md.
// Pure synchronous TypeScript. No DOM, no async, no console.*.

import type { AgentConfig } from "./models";
import { MODELS } from "./models";

export type ParsedRun = {
  sourceModel?: string; // best-effort from trace; undefined if not found
  runs: number; // # of model API calls observed
  avgInputTokens: number; // avg input_tokens across runs (non-cached)
  avgOutputTokens: number; // avg output_tokens across runs
  avgCacheReadTokens: number; // avg cache_read_input_tokens across runs
  avgCacheCreationTokens: number; // avg cache_creation_input_tokens across runs
  measuredCacheHitRate: number; // see §3 — unrounded float in [0,1]
  toolCallsPerRun: number; // avg tool_use blocks per run; 0 if none (unrounded float)
  warnings: string[]; // non-fatal issues; empty array if clean parse
  // C1 — behavioral signals (additive; SPEC-task-classifier.md §C1).
  // Optional for backward compat: hand-constructed/legacy ParsedRun objects
  // (e.g. existing parseTrace.test.ts fixtures) remain type-legal without it.
  // parseTrace() always populates this at runtime.
  signals?: {
    toolNames: Record<string, number>; // tool_use name → call count across ALL runs
    totalToolCalls: number; // sum of tool_use blocks across ALL runs
    turnCount: number; // number of qualifying assistant turns
    outputToInputRatio: number; // avgOutputTokens / (avgInput + avgCacheRead + avgCacheCreation)
    hasCodeBlocks: boolean; // any text block contains a triple-backtick fence
    hasJsonOutput: boolean; // any text block is/contains a valid top-level JSON object/array
    hasCitations: boolean; // any text block contains a URL or [N] footnote marker
    reasoningTokenRatio: number; // thinking tokens / total output tokens; 0 if none
    repairSignals: number; // count of error-retry indicators (capped at runs * 5)
  };
  // Phase 1/2 ground truth (docs/RESEARCH-validation-methodology.md §2).
  // Optional for backward compat: hand-constructed ParsedRun literals (existing
  // tests) remain type-legal without it. parseTrace() always populates it.
  rawCalls?: RawCall[];
};

// Phase 1/2 validation ground truth (docs/RESEARCH-validation-methodology.md §2).
// Additive: optional on ParsedRun; ignored by parsedRunToConfig and calculateCost.
// Populated by parseTrace() for every qualifying run so reconstructCost.ts can
// re-derive billed cost from provider raw_usage as ground truth.
export type CallFlags = {
  model?: string; // message.model / top-level model
  provider: "anthropic" | "openai" | "gemini" | "unknown"; // C2: single-JSON/array path now detects all three; .jsonl stays Anthropic
  is_batch?: boolean; // Phase 1 correction #4 (batch = 50% off). Default false.
  hasMultimodal?: boolean; // any image/file block seen in captured content
  cacheTtlHint?: "5m" | "1h"; // best-effort from cache_control.ttl; undefined if not detectable
};

export type RawCall = {
  // raw_usage is ALWAYS populated (provider ground truth). raw_request holds the
  // FULL captured API element (Anthropic RESPONSE object for response-traces —
  // responses do not echo the request messages, so this is the reconstructible
  // structured equivalent per deliverable §2, not the literal request).
  // full_text_content.completionText comes from response text blocks; promptText
  // is "" because the request prompt is not echoed in the response (documented
  // limitation; Phase 2 input-side re-tokenization is a follow-up).
  raw_usage: Record<string, unknown>;
  raw_request?: unknown;
  full_text_content?: { promptText: string; completionText: string };
  call_flags: CallFlags;
  request_id?: string;
};

// C2 — provider detected per element in the single-JSON/array path (parseAnthropicJson).
// The .jsonl path (Claude Code) stays Anthropic-only and ignores this type.
export type UsageProvider = "anthropic" | "openai" | "gemini" | "unknown";

export class TraceParseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "EMPTY_INPUT"
      | "NO_USAGE_FIELDS"
      | "JSON_PARSE_FAILED"
      | "NO_ASSISTANT_TURNS",
  ) {
    super(message);
    this.name = "TraceParseError";
  }
}

// Internal accumulator for a single qualifying run (one model API call).
type RunTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  toolCalls: number;
};

// Coerce an Anthropic usage field to a non-negative integer.
// Returns the clamped value plus a flag indicating a clamp/skip condition.
function readUsageNumber(
  value: unknown,
  fieldName: string,
  turnLabel: string,
  warnings: string[],
  required: boolean,
): { value: number; valid: boolean } {
  if (value === undefined) {
    if (required) {
      return { value: 0, valid: false };
    }
    // Optional cache fields: missing → 0 with a warning.
    warnings.push(`${turnLabel}: ${fieldName} missing; assumed 0`);
    return { value: 0, valid: true };
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    if (required) {
      warnings.push(`${turnLabel}: ${fieldName} is not a number; skipped`);
      return { value: 0, valid: false };
    }
    warnings.push(`${turnLabel}: ${fieldName} is not a number; assumed 0`);
    return { value: 0, valid: true };
  }
  if (value < 0) {
    warnings.push(`${turnLabel}: negative token count clamped to 0`);
    return { value: 0, valid: true };
  }
  return { value, valid: true };
}

// Count tool_use blocks in a content array. Non-array → 0, no warning.
function countToolCalls(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const item of content) {
    if (item && typeof item === "object" && (item as { type?: unknown }).type === "tool_use") {
      n += 1;
    }
  }
  return n;
}

// ── C1 — behavioral signal extraction (SPEC-task-classifier.md §C1) ──

// Internal mutable accumulator (not exported). Mutated per turn, finalized once.
type SignalAccumulator = {
  toolNames: Record<string, number>;
  totalToolCalls: number;
  thinkingChars: number; // raw char counts for reasoningTokenRatio computation
  redactedThinkingBlocks: number;
  hasCodeBlocks: boolean;
  hasJsonOutput: boolean;
  hasCitations: boolean;
  repairSignals: number;
};

function newSignalAccumulator(): SignalAccumulator {
  return {
    toolNames: {},
    totalToolCalls: 0,
    thinkingChars: 0,
    redactedThinkingBlocks: 0,
    hasCodeBlocks: false,
    hasJsonOutput: false,
    hasCitations: false,
    repairSignals: 0,
  };
}

// Token estimation uses the 4-chars-per-token approximation (§2.7),
// inlined in finalizeSignals. NOT used for billing — ratio signal only.

const REPAIR_PHRASE =
  /(let me try|i'll try again|that didn't work|let me retry|error occurred|trying a different|apologies, let me|sorry, let me try)/i;

// §2.5 — does a text block contain a parseable top-level JSON object/array or a fenced JSON block?
function textHasJson(text: string): boolean {
  const stripped = text.trim();
  if (stripped.startsWith("{") || stripped.startsWith("[")) {
    try {
      JSON.parse(stripped);
      return true;
    } catch {
      // fall through to fenced-JSON check
    }
  }
  return /```json\s*[[{]/.test(text);
}

// §2.6 — URL or [N] footnote marker in a text block.
function textHasCitations(text: string): boolean {
  return /https?:\/\/[^\s)>]+/.test(text) || /\[\d+\]/.test(text);
}

// Scan a single turn's content array, mutating the accumulator (§4).
// `isAssistantTurn` distinguishes model output (assistant) from environment
// responses (user/human turns carry tool_result blocks → repair signals only).
function accumulateSignals(
  content: unknown,
  acc: SignalAccumulator,
  isAssistantTurn: boolean,
): void {
  if (!Array.isArray(content)) return;

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = block.type;

    if (type === "tool_use") {
      // Only assistant turns carry the model's own tool calls (§3 .jsonl note).
      if (isAssistantTurn) {
        const name =
          typeof block.name === "string" && block.name.length > 0
            ? block.name
            : "<unnamed>";
        acc.toolNames[name] = (acc.toolNames[name] ?? 0) + 1;
        acc.totalToolCalls += 1;
      }
    } else if (type === "tool_result") {
      // Environment's response to a tool call — primary repair signal (§2.8).
      if (block.is_error === true) acc.repairSignals += 1;
    } else if (type === "text") {
      if (typeof block.text === "string") {
        const text = block.text;
        if (text.includes("```")) acc.hasCodeBlocks = true;
        if (textHasJson(text)) acc.hasJsonOutput = true;
        if (textHasCitations(text)) acc.hasCitations = true;
        // Secondary repair signal: error-retry phrasing in assistant text (§2.8).
        if (isAssistantTurn && REPAIR_PHRASE.test(text)) acc.repairSignals += 1;
      }
    } else if (type === "thinking") {
      if (typeof block.thinking === "string") {
        acc.thinkingChars += block.thinking.length;
      }
    } else if (type === "redacted_thinking") {
      acc.redactedThinkingBlocks += 1;
    }
  }
}

// Finalize accumulator into the signals object after all turns are processed (§4).
function finalizeSignals(
  acc: SignalAccumulator,
  p: ParsedRun,
): NonNullable<ParsedRun["signals"]> {
  const denominator =
    p.avgInputTokens + p.avgCacheReadTokens + p.avgCacheCreationTokens;
  const outputToInputRatio =
    denominator === 0 ? 0 : p.avgOutputTokens / denominator;

  // reasoningTokenRatio: thinking tokens / total output tokens (§2.7).
  // estimateTokens(s) = ceil(s.length/4); applied to accumulated thinking chars.
  const thinkingTokens =
    Math.ceil(acc.thinkingChars / 4) + acc.redactedThinkingBlocks * 50;
  const totalOutputTokens = p.runs * p.avgOutputTokens;
  const reasoningTokenRatio =
    totalOutputTokens === 0 ? 0 : thinkingTokens / totalOutputTokens;

  // Cap repairSignals at runs * 5 (§2.8).
  const repairSignals = Math.min(acc.repairSignals, p.runs * 5);

  return {
    toolNames: acc.toolNames,
    totalToolCalls: acc.totalToolCalls,
    turnCount: p.runs, // = qualifying assistant turn count (§2.2 / §3)
    outputToInputRatio,
    hasCodeBlocks: acc.hasCodeBlocks,
    hasJsonOutput: acc.hasJsonOutput,
    hasCitations: acc.hasCitations,
    reasoningTokenRatio,
    repairSignals,
  };
}

// ── C2 — multi-provider ingestion (docs/SPEC-trace-parser.md §11) ──
// Single-JSON/array path only (parseAnthropicJson). The .jsonl path (Claude Code)
// stays Anthropic-only. These helpers are PURE and push NO warnings, so the
// clean-parse invariant (Case 1: result.warnings.length === 0) is preserved.

// Detect provider + the usage object to read from one parsed element.
// Anthropic/OpenAI: usage at obj.usage (field-named). Gemini: usage at
// obj.usage_metadata (or flat on obj when prompt_token_count is top-level).
// Returns the usage object even when unrecognized so the caller can emit the
// Anthropic-style skip warning.
function detectElementUsage(
  obj: Record<string, unknown> | undefined,
): { provider: UsageProvider; usage: Record<string, unknown> | undefined } {
  if (obj) {
    const u = obj.usage;
    if (u && typeof u === "object") {
      const usage = u as Record<string, unknown>;
      if ("input_tokens" in usage) return { provider: "anthropic", usage };
      if ("prompt_tokens" in usage) return { provider: "openai", usage };
      return { provider: "unknown", usage };
    }
    const um = obj.usage_metadata;
    if ((um && typeof um === "object") || "prompt_token_count" in obj) {
      const usage =
        um && typeof um === "object"
          ? (um as Record<string, unknown>)
          : obj;
      return { provider: "gemini", usage };
    }
  }
  return { provider: "unknown", usage: undefined };
}

// Provider-aware usage normalization for the heuristic RunTokens aggregate.
// GROUND TRUTH lives in raw_usage (preserved verbatim by extractRawCall); these
// numbers feed only the heuristic counterfactual. Anthropic input_tokens is
// NON-cached (cache is separate); OpenAI prompt_tokens / Gemini prompt_token_count
// are TOTAL prompt, so cached is SUBTRACTED to get non-cached input. Pure: no warnings.
function normalizeUsage(
  usage: Record<string, unknown>,
  provider: UsageProvider,
): { input: number; output: number; cacheRead: number; cacheCreation: number } {
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const asObj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;

  if (provider === "openai") {
    const promptTokens = n(usage.prompt_tokens);
    const cached = n(asObj(usage.prompt_tokens_details)?.cached_tokens);
    return {
      input: Math.max(0, promptTokens - cached),
      output: n(usage.completion_tokens),
      cacheRead: cached,
      cacheCreation: 0,
    };
  }
  if (provider === "gemini") {
    const promptTokens = n(usage.prompt_token_count);
    const cached = n(usage.cached_content_token_count);
    return {
      input: Math.max(0, promptTokens - cached),
      output: n(usage.candidates_token_count) + n(usage.thoughts_token_count),
      cacheRead: cached,
      cacheCreation: 0,
    };
  }
  if (provider === "anthropic") {
    return {
      input: n(usage.input_tokens),
      output: n(usage.output_tokens),
      cacheRead: n(usage.cache_read_input_tokens),
      cacheCreation: n(usage.cache_creation_input_tokens),
    };
  }
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
}

// Extract a single run's token block from an object that holds a `usage` object.
// `turnLabel` is used in warnings. Returns null when the run must be skipped
// (e.g. input_tokens absent/non-number — caller decides the consequence).
// `provider` defaults to 'anthropic' (the .jsonl path + the Anthropic clean-parse
// contract). Non-Anthropic providers take a warning-free normalizeUsage path.
function extractRun(
  usage: Record<string, unknown> | undefined,
  content: unknown,
  turnLabel: string,
  warnings: string[],
  provider: UsageProvider = "anthropic",
): RunTokens | null {
  if (!usage || typeof usage !== "object") return null;

  if (provider !== "anthropic") {
    // C2 — clean parse: OpenAI/Gemini responses push NO warnings.
    const norm = normalizeUsage(usage, provider);
    return {
      input: norm.input,
      output: norm.output,
      cacheRead: norm.cacheRead,
      cacheCreation: norm.cacheCreation,
      toolCalls: countToolCalls(content),
    };
  }

  const input = readUsageNumber(usage.input_tokens, "input_tokens", turnLabel, warnings, true);
  if (!input.valid) return null;

  const output = readUsageNumber(usage.output_tokens, "output_tokens", turnLabel, warnings, false);
  const cacheRead = readUsageNumber(
    usage.cache_read_input_tokens,
    "cache_read_input_tokens",
    turnLabel,
    warnings,
    false,
  );
  const cacheCreation = readUsageNumber(
    usage.cache_creation_input_tokens,
    "cache_creation_input_tokens",
    turnLabel,
    warnings,
    false,
  );

  return {
    input: input.value,
    output: output.value,
    cacheRead: cacheRead.value,
    cacheCreation: cacheCreation.value,
    toolCalls: countToolCalls(content),
  };
}

// ── Phase 1/2 ground-truth capture (docs/RESEARCH-validation-methodology.md §2) ──
// All helpers below are pure and side-effect-free: they push NO warnings, so the
// clean-parse invariant (Case 1: result.warnings.length === 0) is preserved.

// Concatenate every block where block.type === "text" && typeof block.text === "string".
// Non-array → "". Also accepts a plain string (some providers/shapes return content
// as a string rather than a block array).
function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const item of content) {
    if (item && typeof item === "object") {
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") {
        out += block.text;
      }
    }
  }
  return out;
}

// Provider-aware completion-text extraction. Anthropic uses content[].text blocks
// (handled by extractTextFromContent). OpenAI Chat Completions carries the
// assistant message under choices[].message.content (a string or a content-array).
// Gemini GenerateContent carries text under candidates[].content.parts[].text.
// Falls through to extractTextFromContent(obj.content) for Anthropic / unknown.
// Pure: pushes NO warnings (clean-parse invariant preserved).
function extractCompletionText(
  obj: Record<string, unknown> | undefined,
  provider: UsageProvider,
): string {
  if (!obj) return "";
  if (provider === "openai") {
    const choices = obj.choices;
    if (!Array.isArray(choices)) return "";
    let out = "";
    for (const choice of choices) {
      if (choice && typeof choice === "object") {
        const msg = (choice as Record<string, unknown>).message;
        if (msg && typeof msg === "object") {
          const content = (msg as Record<string, unknown>).content;
          if (typeof content === "string") {
            out += content;
          } else if (Array.isArray(content)) {
            out += extractTextFromContent(content);
          }
        }
      }
    }
    return out;
  }
  if (provider === "gemini") {
    const candidates = obj.candidates;
    if (!Array.isArray(candidates)) return "";
    let out = "";
    for (const cand of candidates) {
      if (cand && typeof cand === "object") {
        const content = (cand as Record<string, unknown>).content;
        if (content && typeof content === "object") {
          const parts = (content as Record<string, unknown>).parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              if (part && typeof part === "object") {
                const text = (part as Record<string, unknown>).text;
                if (typeof text === "string") out += text;
              }
            }
          }
        }
      }
    }
    return out;
  }
  return extractTextFromContent(obj.content);
}

// Phase 2 — prompt-side text capture (docs/RESEARCH-validation-methodology.md §4.3,
// docs/SPEC-phase2-retokenization.md §4). Mirrors extractTextFromContent for the
// input side. Superset: also accepts a plain string (real Claude Code .jsonl
// human turns often carry content as a string, not a block array) so input-side
// re-tokenization works on real traces. Pure: pushes NO warnings.
function extractPromptTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  return extractTextFromContent(content);
}

// True if any block.type is an image/file variant. Non-array → false.
function contentHasMultimodal(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  const multimodalTypes = new Set(["image", "image_url", "file", "image_block"]);
  for (const item of content) {
    if (item && typeof item === "object") {
      const block = item as Record<string, unknown>;
      if (typeof block.type === "string" && multimodalTypes.has(block.type)) {
        return true;
      }
    }
  }
  return false;
}

// Best-effort detection of a 1h cache_control TTL marker. Response-side content
// rarely carries cache_control, so this usually returns undefined.
function detectCacheTtl(
  fullObj: Record<string, unknown> | undefined,
): "5m" | "1h" | undefined {
  if (!fullObj) return undefined;
  const content = fullObj.content;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item && typeof item === "object") {
      const block = item as Record<string, unknown>;
      if (block.type === "cache_control" && block.ttl === "1h") return "1h";
    }
  }
  return undefined;
}

// Build a RawCall from the captured response element + its (already non-null)
// usage object. Shallow-copies usage so later mutation can't corrupt ground truth.
function extractRawCall(
  fullObj: Record<string, unknown> | undefined,
  usage: Record<string, unknown>,
  content: unknown,
  provider: UsageProvider = "anthropic",
): RawCall {
  // C2 — raw_usage is preserved VERBATIM so reconstructCost reads the exact
  // provider fields. Anthropic/OpenAI: shallow-copy the response.usage fields.
  // Gemini raw_usage always carries a usage_metadata key so
  // reconstructCost.detectProvider recognizes it even for flat (non-standard)
  // elements; detectElementUsage resolves `usage` to the nested usage_metadata
  // object OR the element itself (flat case), so { ...usage } covers both.
  const rawUsage: Record<string, unknown> =
    provider === "gemini"
      ? { usage_metadata: { ...usage } }
      : { ...usage };

  // model: anthropic/openai read fullObj.model; gemini prefers model_version.
  const model =
    provider === "gemini"
      ? fullObj && typeof fullObj.model_version === "string"
        ? fullObj.model_version
        : fullObj && typeof fullObj.model === "string"
          ? fullObj.model
          : undefined
      : fullObj && typeof fullObj.model === "string"
        ? fullObj.model
        : undefined;

  return {
    raw_usage: rawUsage,
    raw_request: fullObj,
    full_text_content: {
      promptText: "",
      completionText: extractCompletionText(fullObj, provider),
    },
    call_flags: {
      model,
      provider,
      is_batch: false, // responses do not reveal batch; correction #4 hooks here when request metadata is available
      hasMultimodal: contentHasMultimodal(content),
      cacheTtlHint: detectCacheTtl(fullObj),
    },
    request_id:
      fullObj && typeof fullObj.request_id === "string"
        ? fullObj.request_id
        : undefined,
  };
}

// Aggregate the collected runs into a ParsedRun (§2, §3 rounding rules).
function aggregate(
  runsData: RunTokens[],
  sourceModel: string | undefined,
  warnings: string[],
  signalAcc?: SignalAccumulator,
  rawCalls?: RawCall[],
): ParsedRun {
  const runs = runsData.length;

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalToolCalls = 0;

  for (const r of runsData) {
    totalInput += r.input;
    totalOutput += r.output;
    totalCacheRead += r.cacheRead;
    totalCacheCreation += r.cacheCreation;
    totalToolCalls += r.toolCalls;
  }

  // measuredCacheHitRate — computed over the full token pool (§3).
  const cacheDenominator = totalCacheRead + totalInput + totalCacheCreation;
  let measuredCacheHitRate = cacheDenominator === 0 ? 0 : totalCacheRead / cacheDenominator;
  if (measuredCacheHitRate < 0) measuredCacheHitRate = 0;
  if (measuredCacheHitRate > 1) measuredCacheHitRate = 1;

  const parsed: ParsedRun = {
    sourceModel,
    runs,
    avgInputTokens: Math.round(totalInput / runs),
    avgOutputTokens: Math.round(totalOutput / runs),
    avgCacheReadTokens: Math.round(totalCacheRead / runs),
    avgCacheCreationTokens: Math.round(totalCacheCreation / runs),
    measuredCacheHitRate,
    toolCallsPerRun: totalToolCalls / runs, // unrounded float (§2)
    warnings,
  };

  // C1 — attach behavioral signals (finalized from the per-turn accumulator).
  // If no accumulator was threaded (legacy caller), default to zero-equivalents.
  parsed.signals = finalizeSignals(signalAcc ?? newSignalAccumulator(), parsed);

  // Phase 1/2 — attach raw ground-truth calls. Always set on the parseTrace
  // output path; legacy hand-constructed ParsedRun literals skip aggregate and
  // remain type-legal (the field is optional).
  parsed.rawCalls = rawCalls ?? [];

  return parsed;
}

export function parseTrace(raw: string): ParsedRun {
  // Step 1 — empty check.
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new TraceParseError("Input is empty.", "EMPTY_INPUT");
  }

  const warnings: string[] = [];

  // Step 2 — PASS 1: whole-string JSON.parse.
  let wholeParsed: unknown;
  let wholeParseOk = true;
  try {
    wholeParsed = JSON.parse(trimmed);
  } catch {
    wholeParseOk = false;
  }

  if (wholeParseOk) {
    // format = "anthropic-json"
    return parseAnthropicJson(wholeParsed, warnings);
  }

  // Step 3 — PASS 2: .jsonl fallback (line-by-line).
  return parseJsonl(trimmed, warnings);
}

function parseAnthropicJson(parsed: unknown, warnings: string[]): ParsedRun {
  // Normalize: array → each element is a run; object → single-element array.
  const elements: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

  const runsData: RunTokens[] = [];
  const rawCalls: RawCall[] = [];
  let sourceModel: string | undefined;
  const signalAcc = newSignalAccumulator();

  elements.forEach((el, idx) => {
    const turnLabel = `Element ${idx + 1}`;
    const obj = el && typeof el === "object" ? (el as Record<string, unknown>) : undefined;

    // C2 — detect provider per element so a pasted OpenAI or Gemini response is
    // ingested alongside Anthropic ones (docs/SPEC-trace-parser.md §11).
    const { provider, usage } = detectElementUsage(obj);

    if (!usage || !obj) {
      warnings.push(`${turnLabel}: no recognized usage; skipped`);
      return;
    }

    // Qualifying check is provider-aware: Anthropic input_tokens, OpenAI
    // prompt_tokens, Gemini prompt_token_count / usage_metadata presence.
    const qualified =
      (provider === "anthropic" && usage.input_tokens !== undefined) ||
      (provider === "openai" && usage.prompt_tokens !== undefined) ||
      (provider === "gemini" &&
        (usage.prompt_token_count !== undefined ||
          obj.usage_metadata !== undefined ||
          "prompt_token_count" in obj));
    if (!qualified) {
      warnings.push(`${turnLabel}: no recognized usage field; skipped`);
      return;
    }

    const run = extractRun(usage, obj?.content, turnLabel, warnings, provider);
    if (!run) return;

    // sourceModel: anthropic/openai read obj.model; gemini prefers model_version.
    if (sourceModel === undefined && obj) {
      const m =
        provider === "gemini"
          ? typeof obj.model_version === "string"
            ? obj.model_version
            : typeof obj.model === "string"
              ? obj.model
              : undefined
          : typeof obj.model === "string"
            ? obj.model
            : undefined;
      if (typeof m === "string") sourceModel = m;
    }
    // C1 — each qualifying element is an assistant turn.
    accumulateSignals(obj?.content, signalAcc, true);
    runsData.push(run);
    rawCalls.push(extractRawCall(obj, usage, obj?.content, provider));
  });

  // If NO element carried a recognized usage field → NO_USAGE_FIELDS.
  if (runsData.length === 0) {
    throw new TraceParseError(
      "JSON parsed but no object contained a recognized usage field.",
      "NO_USAGE_FIELDS",
    );
  }

  return aggregate(runsData, sourceModel, warnings, signalAcc, rawCalls);
}

function parseJsonl(trimmed: string, warnings: string[]): ParsedRun {
  const lines = trimmed.split("\n");
  // Phase 2 — rolling buffer of user/system text seen before each assistant turn.
  let promptTextBuffer = "";

  const parsedLines: unknown[] = [];
  let anyLineParsed = false;

  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t === "") return; // ignore blank lines
    try {
      parsedLines.push(JSON.parse(t));
      anyLineParsed = true;
    } catch {
      warnings.push(`Line ${idx + 1}: JSON parse failed; skipped`);
    }
  });

  // If ZERO lines parsed at all → genuinely malformed single value.
  if (!anyLineParsed) {
    throw new TraceParseError(
      "Input is not valid JSON and no line parsed as JSON.",
      "JSON_PARSE_FAILED",
    );
  }

  // Keep only type === "assistant" lines with message.usage.input_tokens.
  const runsData: RunTokens[] = [];
  const rawCalls: RawCall[] = [];
  let sourceModel: string | undefined;
  const signalAcc = newSignalAccumulator();

  parsedLines.forEach((parsed, idx) => {
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
    if (!obj) return;

    const message =
      obj.message && typeof obj.message === "object"
        ? (obj.message as Record<string, unknown>)
        : undefined;

    if (obj.type !== "assistant") {
      // C1 — non-assistant turns (human/user/result): scan only for repair
      // signals from tool_result blocks (§3). Token counting still skips them.
      if (message) {
        accumulateSignals(message.content, signalAcc, false);
        // Phase 2 — accumulate user/system text preceding the next assistant
        // turn as promptText (docs/SPEC-phase2-retokenization.md §4).
        const piece = extractPromptTextFromContent(message.content);
        if (piece.length > 0) {
          promptTextBuffer =
            promptTextBuffer.length === 0
              ? piece
              : `${promptTextBuffer}\n${piece}`;
        }
      }
      return;
    }

    const usage =
      message && message.usage && typeof message.usage === "object"
        ? (message.usage as Record<string, unknown>)
        : undefined;

    if (!usage || usage.input_tokens === undefined) return; // not a qualifying assistant turn

    const turnLabel = `Turn ${idx + 1}`;
    const run = extractRun(usage, message?.content, turnLabel, warnings);
    if (!run) return;

    if (sourceModel === undefined && message && typeof message.model === "string") {
      sourceModel = message.model;
    }
    // C1 — accumulate assistant-turn signals (tool_use, text, thinking).
    accumulateSignals(message?.content, signalAcc, true);
    runsData.push(run);
    // Phase 2 — snapshot accumulated user/system text as this call's promptText.
    // We ACCUMULATE across turns (no reset): promptText = all user-text seen
    // BEFORE this turn. This is a LOWER BOUND on raw_usage.input_tokens, which
    // also includes the system prompt, prior ASSISTANT turns, and tool_result
    // blocks — none of which we capture here (out of scope for this increment).
    // Accumulating (not resetting) keeps promptDiffPct growing with the real
    // context size instead of collapsing to a per-turn delta; the residual
    // undercount is documented in docs/SPEC-phase2-retokenization.md §4.
    // parseAnthropicJson is unchanged: its RawCalls keep promptText "".
    const rawCall = extractRawCall(message, usage, message?.content);
    if (rawCall.full_text_content) {
      rawCall.full_text_content.promptText = promptTextBuffer;
    }
    rawCalls.push(rawCall);
  });

  // Detected as .jsonl but zero qualifying assistant turns → NO_ASSISTANT_TURNS.
  if (runsData.length === 0) {
    throw new TraceParseError(
      "Parsed as .jsonl but found no assistant turns with usage.",
      "NO_ASSISTANT_TURNS",
    );
  }

  return aggregate(runsData, sourceModel, warnings, signalAcc, rawCalls);
}

// §4 — map a ParsedRun to the existing AgentConfig shape.
// Mutates p.warnings in place for the unknown-model and default-tool-token notes.
export function parsedRunToConfig(p: ParsedRun): AgentConfig {
  // Fuzzy match sourceModel against MODELS[].id (Anthropic appends date suffixes).
  let modelId = "claude-sonnet-4-6";
  if (p.sourceModel) {
    const src = p.sourceModel;
    const match = MODELS.find((m) => src === m.id || src.includes(m.id));
    if (match) {
      modelId = match.id;
    } else {
      p.warnings.push(
        `sourceModel ${src} not found in MODELS; defaulted to claude-sonnet-4-6`,
      );
    }
  }

  if (p.toolCallsPerRun > 0) {
    p.warnings.push(
      "tokensPerToolCall defaulted to 200 (no reliable signal in trace)",
    );
  }

  p.warnings.push(
    "runsPerDay set to run count from trace; adjust to your actual daily volume",
  );

  return {
    modelId,
    systemPromptTokens: p.avgCacheCreationTokens,
    inputTokensPerRun: p.avgInputTokens,
    outputTokensPerRun: p.avgOutputTokens,
    toolCallsPerRun: p.toolCallsPerRun,
    tokensPerToolCall: 200,
    cacheHitRate: p.measuredCacheHitRate,
    runsPerDay: p.runs,
  };
}
