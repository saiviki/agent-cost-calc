import { MODELS, type AgentConfig } from "./models";

export class PasteUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasteUsageError";
  }
}

export type UsageSpan = {
  input_tokens: number;
  output_tokens: number;
  cached_tokens?: number;
  tool_name?: string;
  model_id?: string;
};

export type UsagePaste = {
  model_id?: string;
  spans: UsageSpan[];
};

/** Slider-facing fields produced by a paste. `runsPerDay` is not in the paste. */
export type ParsedUsageConfig = Omit<AgentConfig, "runsPerDay">;

export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
export const MAX_PASTE_CHARS = 64 * 1024;
export const MAX_TOKEN_VALUE = 10_000_000;

/**
 * Mapping (one paste = one agent run):
 * - systemPromptTokens = 0 (format has no system field; this is intentional)
 * - inputTokensPerRun = Σ input_tokens
 * - outputTokensPerRun = Σ output_tokens
 * - toolCallsPerRun = count of spans with a non-empty tool_name
 * - tokensPerToolCall = 0 (span tokens already sit in input/output)
 * - cacheHitRate = Σ cached_tokens / Σ input_tokens
 * - modelId = top-level model_id, else first span model_id, else default
 * - runsPerDay is not returned; the UI keeps the current volume slider
 *
 * CSV: unquoted rows only. Quoted fields are rejected, not misparsed.
 */

export function usageToConfig(paste: UsagePaste): ParsedUsageConfig {
  if (!paste.spans.length) {
    throw new PasteUsageError("Paste must include at least one span.");
  }

  let inputSum = 0;
  let outputSum = 0;
  let cachedSum = 0;
  let toolCalls = 0;

  for (const span of paste.spans) {
    inputSum += span.input_tokens;
    outputSum += span.output_tokens;
    cachedSum += span.cached_tokens ?? 0;
    if (span.tool_name && span.tool_name.trim() !== "") {
      toolCalls += 1;
    }
    if ((span.cached_tokens ?? 0) > span.input_tokens) {
      throw new PasteUsageError(
        "cached_tokens cannot exceed input_tokens on a span.",
      );
    }
  }

  if (cachedSum > inputSum) {
    throw new PasteUsageError(
      "cached_tokens cannot exceed input_tokens in total.",
    );
  }

  if (inputSum > MAX_TOKEN_VALUE || outputSum > MAX_TOKEN_VALUE) {
    throw new PasteUsageError(
      `Token totals must be at most ${MAX_TOKEN_VALUE.toLocaleString()}.`,
    );
  }

  const cacheHitRate = inputSum > 0 ? cachedSum / inputSum : 0;

  const rawModel =
    paste.model_id?.trim() ||
    paste.spans.find((s) => s.model_id?.trim())?.model_id?.trim() ||
    "";

  return {
    modelId: resolveModelId(rawModel),
    systemPromptTokens: 0,
    inputTokensPerRun: Math.round(inputSum),
    outputTokensPerRun: Math.round(outputSum),
    toolCallsPerRun: toolCalls,
    tokensPerToolCall: 0,
    cacheHitRate,
  };
}

function resolveModelId(raw: string): string {
  if (!raw) return DEFAULT_MODEL_ID;
  const match = MODELS.find((m) => m.id === raw || m.sourceId === raw);
  if (!match) {
    throw new PasteUsageError(
      `Unknown model_id "${raw}". Use a lineup id such as ${DEFAULT_MODEL_ID}.`,
    );
  }
  return match.id;
}

function requireToken(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PasteUsageError(`${field} must be a non-negative finite number.`);
  }
  if (value > MAX_TOKEN_VALUE) {
    throw new PasteUsageError(
      `${field} must be at most ${MAX_TOKEN_VALUE.toLocaleString()}.`,
    );
  }
  return Math.round(value);
}

function parseSpanObject(obj: Record<string, unknown>, label: string): UsageSpan {
  if (obj.input_tokens === undefined || obj.output_tokens === undefined) {
    throw new PasteUsageError(
      `${label} requires input_tokens and output_tokens.`,
    );
  }
  const span: UsageSpan = {
    input_tokens: requireToken(obj.input_tokens, `${label}.input_tokens`),
    output_tokens: requireToken(obj.output_tokens, `${label}.output_tokens`),
  };
  if (obj.cached_tokens !== undefined) {
    span.cached_tokens = requireToken(
      obj.cached_tokens,
      `${label}.cached_tokens`,
    );
  }
  if (typeof obj.tool_name === "string" && obj.tool_name.trim() !== "") {
    span.tool_name = obj.tool_name.trim();
  }
  if (typeof obj.model_id === "string" && obj.model_id.trim() !== "") {
    span.model_id = obj.model_id.trim();
  }
  return span;
}

function parseJsonUsage(raw: string): UsagePaste {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PasteUsageError("Invalid JSON.");
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new PasteUsageError("Paste must include at least one span.");
    }
    return {
      spans: parsed.map((item, i) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new PasteUsageError(`Span ${i + 1} must be an object.`);
        }
        return parseSpanObject(item as Record<string, unknown>, `Span ${i + 1}`);
      }),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new PasteUsageError("JSON must be an object or an array of spans.");
  }

  const obj = parsed as Record<string, unknown>;
  const spansRaw = obj.spans;
  if (!Array.isArray(spansRaw) || spansRaw.length === 0) {
    throw new PasteUsageError('JSON must include a non-empty "spans" array.');
  }

  const paste: UsagePaste = {
    spans: spansRaw.map((item, i) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new PasteUsageError(`Span ${i + 1} must be an object.`);
      }
      return parseSpanObject(item as Record<string, unknown>, `Span ${i + 1}`);
    }),
  };

  if (typeof obj.model_id === "string" && obj.model_id.trim() !== "") {
    paste.model_id = obj.model_id.trim();
  }

  return paste;
}

function parseCsvUsage(raw: string): UsagePaste {
  if (/["']/.test(raw)) {
    throw new PasteUsageError(
      "Quoted CSV fields are not supported. Use unquoted CSV or JSON.",
    );
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length < 2) {
    throw new PasteUsageError(
      "CSV needs a header row and at least one data row.",
    );
  }

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const inputIdx = idx("input_tokens");
  const outputIdx = idx("output_tokens");
  if (inputIdx < 0 || outputIdx < 0) {
    throw new PasteUsageError(
      "CSV header must include input_tokens and output_tokens.",
    );
  }
  const cachedIdx = idx("cached_tokens");
  const toolIdx = idx("tool_name");
  const modelIdx = idx("model_id");

  const spans: UsageSpan[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const span: UsageSpan = {
      input_tokens: requireToken(
        Number(cols[inputIdx]),
        `Row ${i + 1}.input_tokens`,
      ),
      output_tokens: requireToken(
        Number(cols[outputIdx]),
        `Row ${i + 1}.output_tokens`,
      ),
    };
    if (cachedIdx >= 0 && cols[cachedIdx] !== undefined && cols[cachedIdx] !== "") {
      span.cached_tokens = requireToken(
        Number(cols[cachedIdx]),
        `Row ${i + 1}.cached_tokens`,
      );
    }
    if (toolIdx >= 0 && cols[toolIdx]) {
      span.tool_name = cols[toolIdx];
    }
    if (modelIdx >= 0 && cols[modelIdx]) {
      span.model_id = cols[modelIdx];
    }
    spans.push(span);
  }

  return { spans };
}

/** Parse simple usage JSON or unquoted CSV into slider fields. */
export function parseUsagePaste(raw: string): ParsedUsageConfig {
  if (raw.length > MAX_PASTE_CHARS) {
    throw new PasteUsageError(
      `Paste is too large (${raw.length.toLocaleString()} chars). Max is ${MAX_PASTE_CHARS.toLocaleString()}.`,
    );
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new PasteUsageError("Input is empty.");
  }

  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const paste = looksJson ? parseJsonUsage(trimmed) : parseCsvUsage(trimmed);
  return usageToConfig(paste);
}
