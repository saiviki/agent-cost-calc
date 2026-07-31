import type {
  Catalog,
  ModelCost,
  ModelMetadata,
  BenchmarkResult,
} from "./models-dev-types";
import type { EditorialEntry } from "./model-catalog";
import type { Tier, Strength, ModelCapability, CapabilityScores, CapabilityConfidence, BenchmarkEntry } from "../src/lib/models";

export type GeneratedPricing = {
  id: string;
  sourceId: string;
  name: string;
  provider: string;
  isOpen: boolean;
  tier: Tier;
  strengths: Strength[];
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
  outputMultiplier: number;
  multiplierSource?: string;
  multiplierConfidence?: "high" | "med" | "low";
  capability?: ModelCapability;
  benchmarks?: BenchmarkEntry[];
};

export const LAB_DISPLAY_NAME: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  alibaba: "Alibaba",
  meta: "Meta",
  zhipuai: "Z.ai",
  deepseek: "DeepSeek",
  moonshotai: "Moonshot",
  minimax: "MiniMax",
  mistral: "Mistral",
  cohere: "Cohere",
  together: "Together",
  groq: "Groq",
  fireworks: "Fireworks",
  deepinfra: "DeepInfra",
  aws: "AWS Bedrock",
  azure: "Azure OpenAI",
};

export function splitSourceId(sourceId: string): { lab: string; model: string } {
  if (!sourceId || typeof sourceId !== "string") {
    return { lab: "", model: "" };
  }
  const slashIdx = sourceId.indexOf("/");
  if (slashIdx === -1) {
    return { lab: "", model: sourceId };
  }
  return {
    lab: sourceId.slice(0, slashIdx),
    model: sourceId.slice(slashIdx + 1),
  };
}

export function labDisplayName(lab: string): string {
  if (!lab) return "";
  return LAB_DISPLAY_NAME[lab] ?? lab;
}

export function metadataToDisplayName(
  metadata: ModelMetadata | undefined,
  sourceId: string
): string {
  if (metadata?.name && metadata.name.trim().length > 0) {
    return metadata.name.trim();
  }
  const { model } = splitSourceId(sourceId || "");
  const raw = model || sourceId || "";
  return raw
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

export function inferTier(
  inputPrice: number,
  outputPrice: number,
  isReasoning: boolean
): Tier {
  if (isReasoning || inputPrice >= 2.0 || outputPrice >= 10.0) {
    return "frontier";
  }
  if (inputPrice >= 0.4 || outputPrice >= 1.8) {
    return "mid";
  }
  return "budget";
}

export function inferStrengths(
  metadata: ModelMetadata | undefined,
  inputPrice: number,
  name: string,
  sourceId?: string
): Strength[] {
  const strengths: Set<Strength> = new Set(["general"]);
  const lowerName = name.toLowerCase();
  const lowerId = (sourceId || "").toLowerCase();
  const lowerDesc = (metadata?.description || "").toLowerCase();
  const text = `${lowerName} ${lowerId} ${lowerDesc}`;

  // Reasoning models
  if (
    metadata?.reasoning ||
    [
      "reasoning",
      "thinking",
      "reasoner",
      "o1",
      "o3",
      "o4",
      "r1",
      "qwq",
      "deepseek-r",
      "kimi-k",
      "opus",
      "pro",
    ].some((kw) => text.includes(kw))
  ) {
    strengths.add("reasoning");
  }

  // Coding models
  if (
    metadata?.tool_call ||
    [
      "coder",
      "coding",
      "code",
      "devstral",
      "codestral",
      "codex",
      "sonnet",
      "gpt-4",
      "gpt-5",
      "claude",
      "qwen",
      "llama",
      "deepseek",
      "glm",
      "minimax",
      "step",
      "mimo",
    ].some((kw) => text.includes(kw))
  ) {
    strengths.add("coding");
  }

  // Multimodal models (vision, audio, video, pdf)
  if (
    metadata?.modalities?.input?.some((m) =>
      ["image", "video", "audio", "pdf"].includes(m)
    ) ||
    metadata?.modalities?.output?.some((m) =>
      ["image", "video", "audio", "pdf"].includes(m)
    ) ||
    [
      "vl",
      "vision",
      "multimodal",
      "audio",
      "omni",
      "image",
      "tts",
      "live",
      "picture",
    ].some((kw) => text.includes(kw))
  ) {
    strengths.add("multimodal");
  }

  // Long context models (>= 64k tokens)
  if (
    (metadata?.limit?.context ?? 0) >= 64000 ||
    ["1m", "2m", "128k", "200k", "100k", "long"].some((kw) => text.includes(kw))
  ) {
    strengths.add("long-context");
  }

  // Fast / lightweight models
  if (
    inputPrice < 0.8 &&
    [
      "flash",
      "mini",
      "haiku",
      "fast",
      "lite",
      "micro",
      "nano",
      "small",
      "air",
      "turbo",
      "instant",
      "quick",
      "highspeed",
    ].some((kw) => text.includes(kw))
  ) {
    strengths.add("fast");
  }

  return Array.from(strengths);
}

export function extractCapabilityFromBenchmarks(
  benchmarks: BenchmarkResult[] | undefined
): { scores: CapabilityScores; confidence: CapabilityConfidence } | null {
  if (!benchmarks || benchmarks.length === 0) return null;

  const codingScores: number[] = [];
  const reasoningScores: number[] = [];
  const generalScores: number[] = [];

  for (const b of benchmarks) {
    const name = (b.name || "").toLowerCase();
    const source = (b.source || "").toLowerCase();
    const score = typeof b.score === "number" ? b.score : parseFloat(String(b.score));
    if (isNaN(score)) continue;

    let normalizedScore = score;
    if (score > 500) {
      normalizedScore = Math.min(100, Math.max(0, (score - 1000) / 4 + 50));
    }

    if (
      name.includes("code") ||
      name.includes("swe") ||
      name.includes("terminal") ||
      name.includes("humaneval") ||
      source.includes("coding")
    ) {
      codingScores.push(normalizedScore);
    }
    if (
      name.includes("math") ||
      name.includes("reason") ||
      name.includes("gpqa") ||
      name.includes("aime") ||
      name.includes("mmlu") ||
      name.includes("gsm8k") ||
      source.includes("reasoning")
    ) {
      reasoningScores.push(normalizedScore);
    }
    if (
      name.includes("arena") ||
      name.includes("elo") ||
      name.includes("intelligence") ||
      name.includes("general") ||
      source.includes("intelligence")
    ) {
      generalScores.push(normalizedScore);
    }
  }

  if (codingScores.length === 0 && reasoningScores.length === 0 && generalScores.length === 0) {
    return null;
  }

  const avg = (arr: number[], fallback: number) =>
    arr.length > 0
      ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
      : fallback;

  const genScore = avg(generalScores, 70);
  const codScore = avg(codingScores, genScore);
  const reaScore = avg(reasoningScores, genScore);

  return {
    scores: {
      coding: codScore,
      reasoning: reaScore,
      general: genScore,
    },
    confidence: "high",
  };
}

export function inferCapability(
  tier: Tier,
  isReasoning: boolean,
  isCoding: boolean,
  metadata?: ModelMetadata
): ModelCapability {
  const extracted = extractCapabilityFromBenchmarks(metadata?.benchmarks);
  if (extracted) {
    return {
      scores: extracted.scores,
      confidence: {
        coding: extracted.confidence,
        reasoning: extracted.confidence,
        general: extracted.confidence,
      },
    };
  }

  const baseScore = tier === "frontier" ? 82 : tier === "mid" ? 65 : 52;
  const codingScore = baseScore + (isCoding ? 8 : 0);
  const reasoningScore = baseScore + (isReasoning ? 10 : 0);

  return {
    scores: {
      coding: Math.min(95, codingScore),
      reasoning: Math.min(95, reasoningScore),
      general: baseScore,
    },
    confidence: {
      coding: "low",
      reasoning: "low",
      general: "low",
    },
  };
}

export function pickLabProviderCost(
  catalog: Catalog,
  sourceId: string
): { cost?: ModelCost; providerUsed: string } | null {
  if (!sourceId) return null;
  const { lab, model } = splitSourceId(sourceId);
  if (!model) return null;

  if (lab && catalog.providers[lab]) {
    const labModel = catalog.providers[lab]?.models?.[model];
    if (
      labModel?.cost &&
      ((labModel.cost.input ?? 0) > 0 || (labModel.cost.output ?? 0) > 0)
    ) {
      return { cost: labModel.cost, providerUsed: lab };
    }
  }

  const sortedProviderKeys = Object.keys(catalog.providers ?? {}).sort();
  for (const provKey of sortedProviderKeys) {
    const prov = catalog.providers[provKey];
    const provModel = prov?.models?.[model];
    if (
      provModel?.cost &&
      ((provModel.cost.input ?? 0) > 0 || (provModel.cost.output ?? 0) > 0)
    ) {
      return { cost: provModel.cost, providerUsed: provKey };
    }
  }

  return null;
}

export function costToGenerated(
  sourceIdOrEditorial: string | EditorialEntry,
  metadata: ModelMetadata | undefined,
  costPicked: { cost?: ModelCost; providerUsed: string } | null,
  editorialOverride?: EditorialEntry
): GeneratedPricing {
  const editorial =
    typeof sourceIdOrEditorial === "object"
      ? sourceIdOrEditorial
      : editorialOverride;
  const sourceId =
    typeof sourceIdOrEditorial === "string"
      ? sourceIdOrEditorial
      : sourceIdOrEditorial.sourceId;

  const { lab, model } = splitSourceId(sourceId || "");
  const displayName = metadataToDisplayName(metadata, sourceId || "");
  const provider = labDisplayName(lab);
  const isOpen = metadata?.open_weights ?? false;
  const contextK = Math.round((metadata?.limit?.context ?? 0) / 1000);

  const cost = costPicked?.cost;
  const inputPricePerM = cost?.input ?? 0;
  const outputPricePerM = cost?.output ?? 0;
  const cacheReadPricePerM = cost?.cache_read;
  const cacheWritePricePerM = cost?.cache_write;
  const supportsCache =
    cacheReadPricePerM !== undefined || cacheWritePricePerM !== undefined;

  const isReasoning = Boolean(metadata?.reasoning);
  const tier =
    editorial?.tier ?? inferTier(inputPricePerM, outputPricePerM, isReasoning);
  const strengths =
    editorial?.strengths ??
    inferStrengths(metadata, inputPricePerM, displayName, sourceId);

  const outputMultiplier =
    editorial?.outputMultiplier ?? (isReasoning ? 5.0 : 1.0);
  const multiplierSource =
    editorial?.multiplierSource ?? "Derived from models.dev metadata";
  const multiplierConfidence = editorial?.multiplierConfidence ?? "low";

  const isCoding = strengths.includes("coding");
  const capability =
    editorial?.capability ?? inferCapability(tier, isReasoning, isCoding, metadata);

  const id =
    editorial?.id ?? (model || (sourceId ? sourceId.replace("/", "-") : "model"));

  const benchmarks = metadata?.benchmarks ? metadata.benchmarks.slice(0, 5) : undefined;

  return {
    id,
    sourceId,
    name: displayName,
    provider,
    isOpen,
    tier,
    strengths,
    contextK,
    inputPricePerM,
    outputPricePerM,
    cacheReadPricePerM,
    cacheWritePricePerM,
    supportsCache,
    outputMultiplier,
    multiplierSource,
    multiplierConfidence,
    capability,
    benchmarks,
  };
}
