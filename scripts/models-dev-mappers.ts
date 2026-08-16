import type { Catalog, Model, ModelCost, ModelMetadata } from "./models-dev-types";
import type { EditorialEntry } from "./model-catalog";

export type PricingStatus = "live" | "carried-forward";

export type GeneratedPricing = {
  id: string;
  sourceId: string;
  name: string;
  modelDeveloper: string;
  pricingProvider: string;
  pricingStatus: PricingStatus;
  pricingFetchedAt?: string;
  isOpen: boolean;
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
};

export type PickedPrice = {
  cost: ModelCost;
  pricingProvider: string;
  providerModel?: Model;
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
  sourceId: string,
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

function hasUsableCost(cost: ModelCost | undefined): cost is ModelCost {
  if (!cost) return false;
  const input = cost.input ?? 0;
  const output = cost.output ?? 0;
  return (
    Number.isFinite(input) &&
    Number.isFinite(output) &&
    input >= 0 &&
    output >= 0 &&
    (input > 0 || output > 0)
  );
}

function findProviderModel(
  catalog: Catalog,
  providerId: string,
  sourceId: string,
): Model | undefined {
  const provider = catalog.providers[providerId];
  if (!provider?.models) return undefined;
  const { model } = splitSourceId(sourceId);
  return provider.models[model] ?? provider.models[sourceId];
}

/**
 * Resolve price for one editorial mapping.
 *
 * Order is explicit and deterministic:
 *   1. the model developer's own provider listing (`lab` from sourceId)
 *   2. the editorial `fallbackProvider`, if configured
 *
 * Never scans remaining hosts and never picks "first alphabetical".
 */
export function pickEditorialPrice(
  catalog: Catalog,
  sourceId: string,
  fallbackProvider?: string,
): PickedPrice | null {
  if (!sourceId) return null;
  const { lab } = splitSourceId(sourceId);
  if (!lab) return null;

  const labModel = findProviderModel(catalog, lab, sourceId);
  if (hasUsableCost(labModel?.cost)) {
    return {
      cost: labModel.cost,
      pricingProvider: lab,
      providerModel: labModel,
    };
  }

  if (fallbackProvider && fallbackProvider !== lab) {
    const fallbackModel = findProviderModel(catalog, fallbackProvider, sourceId);
    if (hasUsableCost(fallbackModel?.cost)) {
      return {
        cost: fallbackModel.cost,
        pricingProvider: fallbackProvider,
        providerModel: fallbackModel,
      };
    }
  }

  return null;
}

/** @deprecated Use pickEditorialPrice. Kept as a named alias for older tests. */
export const pickLabProviderCost = pickEditorialPrice;

export function costToGenerated(
  editorial: EditorialEntry,
  metadata: ModelMetadata | undefined,
  picked: PickedPrice | null,
  opts?: { fetchedAt?: string; pricingStatus?: PricingStatus },
): GeneratedPricing {
  const sourceId = editorial.sourceId;
  const { lab } = splitSourceId(sourceId);
  const displayName =
    metadataToDisplayName(metadata, sourceId) || editorial.id;
  const modelDeveloper = labDisplayName(lab) || labDisplayName(editorial.id);
  const pricingProvider = picked
    ? labDisplayName(picked.pricingProvider)
    : modelDeveloper;

  const cost = picked?.cost;
  const inputPricePerM = cost?.input ?? 0;
  const outputPricePerM = cost?.output ?? 0;
  const cacheReadPricePerM = cost?.cache_read;
  const cacheWritePricePerM = cost?.cache_write;
  const supportsCache =
    cacheReadPricePerM !== undefined || cacheWritePricePerM !== undefined;

  const contextTokens =
    metadata?.limit?.context ?? picked?.providerModel?.limit?.context ?? 0;
  const isOpen =
    metadata?.open_weights ?? picked?.providerModel?.open_weights ?? false;

  return {
    id: editorial.id,
    sourceId,
    name: displayName,
    modelDeveloper,
    pricingProvider,
    pricingStatus: opts?.pricingStatus ?? "live",
    pricingFetchedAt: opts?.fetchedAt,
    isOpen,
    contextK: Math.round(contextTokens / 1000),
    inputPricePerM,
    outputPricePerM,
    cacheReadPricePerM,
    cacheWritePricePerM,
    supportsCache,
  };
}

type LegacyPricing = Partial<GeneratedPricing> & {
  id: string;
  name?: string;
  provider?: string;
  isOpen?: boolean;
  contextK?: number;
  inputPricePerM?: number;
  outputPricePerM?: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache?: boolean;
  sourceId?: string;
};

export function markCarriedForward(
  prev: LegacyPricing,
  opts?: { id?: string; sourceId?: string },
): GeneratedPricing {
  const modelDeveloper =
    prev.modelDeveloper || prev.provider || "Unknown";
  return {
    id: opts?.id ?? prev.id,
    sourceId: opts?.sourceId ?? prev.sourceId ?? "",
    name: prev.name || opts?.id || prev.id,
    modelDeveloper,
    pricingProvider: prev.pricingProvider || prev.provider || modelDeveloper,
    pricingStatus: "carried-forward",
    pricingFetchedAt: prev.pricingFetchedAt,
    isOpen: Boolean(prev.isOpen),
    contextK: prev.contextK ?? 0,
    inputPricePerM: prev.inputPricePerM ?? 0,
    outputPricePerM: prev.outputPricePerM ?? 0,
    cacheReadPricePerM: prev.cacheReadPricePerM,
    cacheWritePricePerM: prev.cacheWritePricePerM,
    supportsCache: Boolean(prev.supportsCache),
  };
}
