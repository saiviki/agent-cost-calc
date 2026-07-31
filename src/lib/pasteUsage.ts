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

const DEFAULT_MODEL_ID = "claude-sonnet-4-6";
const DEFAULT_RUNS_PER_DAY = 100;

/**
 * Mapping (one paste = one agent run):
 * - systemPromptTokens = 0 (format has no system field)
 * - inputTokensPerRun = Σ input_tokens
 * - outputTokensPerRun = Σ output_tokens
 * - toolCallsPerRun = count of spans with a non-empty tool_name
 * - tokensPerToolCall = 0 (span tokens already sit in input/output; avoids double-count in calculateCost)
 * - cacheHitRate = Σ cached_tokens / Σ input_tokens (clamped 0–1; 0 if no input)
 * - runsPerDay = 100 (volume is not in the paste; user adjusts)
 * - modelId = top-level model_id, else first span model_id, else default
 */
export function usageToConfig(paste: UsagePaste): AgentConfig {
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
  }

  const cacheHitRate =
    inputSum > 0 ? Math.min(1, Math.max(0, cachedSum / inputSum)) : 0;

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
    runsPerDay: DEFAULT_RUNS_PER_DAY,
  };
}

function resolveModelId(raw: string): string {
  if (!raw) return DEFAULT_MODEL_ID;
  const match =
    MODELS.find((m) => m.id === raw || m.sourceId === raw) ??
    MODELS.filter(
      (m) => raw.includes(m.id) || (m.sourceId != null && raw.includes(m.sourceId)),
    ).sort((a, b) => b.id.length - a.id.length)[0];
  return match?.id ?? DEFAULT_MODEL_ID;
}

function requireNonNegInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PasteUsageError(`${field} must be a non-negative number.`);
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
    input_tokens: requireNonNegInt(obj.input_tokens, `${label}.input_tokens`),
    output_tokens: requireNonNegInt(obj.output_tokens, `${label}.output_tokens`),
  };
  if (obj.cached_tokens !== undefined) {
    span.cached_tokens = requireNonNegInt(
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

  // Bare span array
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
    const input = Number(cols[inputIdx]);
    const output = Number(cols[outputIdx]);
    if (!Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      throw new PasteUsageError(
        `Row ${i + 1}: input_tokens and output_tokens must be non-negative numbers.`,
      );
    }
    const span: UsageSpan = {
      input_tokens: Math.round(input),
      output_tokens: Math.round(output),
    };
    if (cachedIdx >= 0 && cols[cachedIdx] !== undefined && cols[cachedIdx] !== "") {
      const cached = Number(cols[cachedIdx]);
      if (!Number.isFinite(cached) || cached < 0) {
        throw new PasteUsageError(
          `Row ${i + 1}: cached_tokens must be a non-negative number.`,
        );
      }
      span.cached_tokens = Math.round(cached);
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

/** Parse simple usage JSON or CSV into AgentConfig for the estimator sliders. */
export function parseUsagePaste(raw: string): AgentConfig {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new PasteUsageError("Input is empty.");
  }

  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const paste = looksJson ? parseJsonUsage(trimmed) : parseCsvUsage(trimmed);
  return usageToConfig(paste);
}
