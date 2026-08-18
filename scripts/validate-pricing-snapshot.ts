import { EDITORIAL_CATALOG, type EditorialEntry } from "./model-catalog";
import type { GeneratedPricing, PricingStatus } from "./models-dev-mappers";

export type PricingSnapshot = {
  source: string;
  fetchedAt: string;
  sourceEndpoint: string;
  models: GeneratedPricing[];
};

export type ValidationIssue = {
  level: "error" | "warning";
  message: string;
};

const PRICING_STATUSES = new Set<PricingStatus>(["live", "carried-forward"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown): value is string {
  return typeof value === "string";
}

function requireFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalFiniteNonNegative(value: unknown): boolean {
  return value === undefined || requireFiniteNonNegative(value);
}

function validateModel(
  model: unknown,
  index: number,
): { issues: ValidationIssue[]; parsed?: GeneratedPricing } {
  const issues: ValidationIssue[] = [];
  const label = `models[${index}]`;
  if (!isRecord(model)) {
    issues.push({ level: "error", message: `${label} must be an object` });
    return { issues };
  }

  if (!requireString(model.id) || model.id.trim() === "") {
    issues.push({ level: "error", message: `${label}.id must be a non-empty string` });
  }
  if (!requireString(model.sourceId)) {
    issues.push({
      level: "error",
      message: `${label}.sourceId must be a string (empty only when unmapped)`,
    });
  }
  if (!requireString(model.name) || model.name.trim() === "") {
    issues.push({ level: "error", message: `${label}.name must be a non-empty string` });
  }
  if (!requireString(model.modelDeveloper) || model.modelDeveloper.trim() === "") {
    issues.push({
      level: "error",
      message: `${label}.modelDeveloper must be a non-empty string`,
    });
  }
  if (!requireString(model.pricingProvider) || model.pricingProvider.trim() === "") {
    issues.push({
      level: "error",
      message: `${label}.pricingProvider must be a non-empty string`,
    });
  }
  if (
    !requireString(model.pricingStatus) ||
    !PRICING_STATUSES.has(model.pricingStatus as PricingStatus)
  ) {
    issues.push({
      level: "error",
      message: `${label}.pricingStatus must be "live" or "carried-forward"`,
    });
  }
  if (model.pricingFetchedAt !== undefined && !requireString(model.pricingFetchedAt)) {
    issues.push({
      level: "error",
      message: `${label}.pricingFetchedAt must be a string when present`,
    });
  }
  if (typeof model.isOpen !== "boolean") {
    issues.push({ level: "error", message: `${label}.isOpen must be a boolean` });
  }
  if (!requireFiniteNonNegative(model.contextK)) {
    issues.push({
      level: "error",
      message: `${label}.contextK must be a finite non-negative number`,
    });
  }
  if (!requireFiniteNonNegative(model.inputPricePerM)) {
    issues.push({
      level: "error",
      message: `${label}.inputPricePerM must be a finite non-negative number`,
    });
  }
  if (!requireFiniteNonNegative(model.outputPricePerM)) {
    issues.push({
      level: "error",
      message: `${label}.outputPricePerM must be a finite non-negative number`,
    });
  }
  if (!optionalFiniteNonNegative(model.cacheReadPricePerM)) {
    issues.push({
      level: "error",
      message: `${label}.cacheReadPricePerM must be a finite non-negative number when present`,
    });
  }
  if (!optionalFiniteNonNegative(model.cacheWritePricePerM)) {
    issues.push({
      level: "error",
      message: `${label}.cacheWritePricePerM must be a finite non-negative number when present`,
    });
  }
  if (typeof model.supportsCache !== "boolean") {
    issues.push({ level: "error", message: `${label}.supportsCache must be a boolean` });
  }

  if (issues.length > 0) return { issues };
  return { issues, parsed: model as unknown as GeneratedPricing };
}

export function validatePricingSnapshot(
  snapshot: unknown,
  editorial: EditorialEntry[] = EDITORIAL_CATALOG,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(snapshot)) {
    return [{ level: "error", message: "Snapshot must be a JSON object" }];
  }

  if (!requireString(snapshot.source) || snapshot.source.trim() === "") {
    issues.push({ level: "error", message: "source must be a non-empty string" });
  }
  if (!requireString(snapshot.sourceEndpoint) || snapshot.sourceEndpoint.trim() === "") {
    issues.push({ level: "error", message: "sourceEndpoint must be a non-empty string" });
  }
  if (!requireString(snapshot.fetchedAt) || Number.isNaN(Date.parse(snapshot.fetchedAt))) {
    issues.push({ level: "error", message: "fetchedAt must be a valid ISO-8601 timestamp" });
  }
  if (!Array.isArray(snapshot.models)) {
    issues.push({ level: "error", message: "models must be an array" });
    return issues;
  }

  const parsed: GeneratedPricing[] = [];
  snapshot.models.forEach((model, index) => {
    const result = validateModel(model, index);
    issues.push(...result.issues);
    if (result.parsed) parsed.push(result.parsed);
  });

  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  for (const model of parsed) {
    if (ids.has(model.id)) {
      issues.push({ level: "error", message: `Duplicate model id: ${model.id}` });
    }
    ids.add(model.id);
    if (model.sourceId) {
      if (sourceIds.has(model.sourceId)) {
        issues.push({
          level: "error",
          message: `Duplicate sourceId: ${model.sourceId}`,
        });
      }
      sourceIds.add(model.sourceId);
    }
  }

  const editorialIds = new Set(editorial.map((e) => e.id));
  for (const entry of editorial) {
    const model = parsed.find((m) => m.id === entry.id);
    if (!model) {
      issues.push({
        level: "error",
        message: `Editorial id missing from snapshot: ${entry.id}`,
      });
      continue;
    }
    if (entry.sourceId && model.sourceId !== entry.sourceId) {
      issues.push({
        level: "error",
        message: `${entry.id}.sourceId ${model.sourceId} does not match editorial ${entry.sourceId}`,
      });
    }
    if (!entry.sourceId && model.pricingStatus !== "carried-forward") {
      issues.push({
        level: "error",
        message: `${entry.id} has no sourceId and must be marked carried-forward`,
      });
    }
    if (model.pricingStatus === "carried-forward") {
      issues.push({
        level: "warning",
        message: `${entry.id} is carried-forward${entry.sourceId ? ` (${entry.sourceId})` : " (no live mapping)"}`,
      });
    }
  }

  for (const model of parsed) {
    if (!editorialIds.has(model.id)) {
      issues.push({
        level: "error",
        message: `Snapshot contains non-editorial model: ${model.id}`,
      });
    }
  }

  return issues;
}

export function formatValidationIssues(issues: ValidationIssue[]): string[] {
  return issues.map((issue) => `[${issue.level}] ${issue.message}`);
}
