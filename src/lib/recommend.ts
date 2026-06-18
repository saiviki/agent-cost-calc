// C4 — Recommendation engine. Implements SPEC-recommend.md §2–§4.
// Pure synchronous TypeScript. No DOM, no async. Does not throw.
// Reuses projectCounterfactual for cost math (applyMultiplier: true) — does NOT
// duplicate calculateCost. ENFORCES the capability floor (§2, Step 5).

import { Model, MODELS } from "./models";
import type { ParsedRun } from "./parseTrace";
import type { Classification, TaskType, Complexity } from "./classifyTask";
import type { AgentConfig } from "./models";
import { projectCounterfactual } from "./counterfactual";

// §2.1 — floor cell: minimum required domain scores. 0 = no constraint.
type FloorCell = {
  coding: number;
  reasoning: number;
  general: number;
};

type CapabilityFloor = Record<TaskType, Record<Complexity, FloorCell>>;

// §2.2 — exact values from RESEARCH-capability-matrix.md (Floor Matrix — Compact Form).
export const CAPABILITY_FLOOR: CapabilityFloor = {
  coding: {
    low: { coding: 50, reasoning: 40, general: 45 },
    med: { coding: 68, reasoning: 55, general: 55 },
    high: { coding: 82, reasoning: 72, general: 70 },
  },
  extraction: {
    low: { coding: 0, reasoning: 35, general: 50 },
    med: { coding: 0, reasoning: 45, general: 62 },
    high: { coding: 0, reasoning: 55, general: 72 },
  },
  research: {
    low: { coding: 0, reasoning: 45, general: 55 },
    med: { coding: 0, reasoning: 60, general: 68 },
    high: { coding: 0, reasoning: 78, general: 82 },
  },
  agentic: {
    low: { coding: 55, reasoning: 52, general: 58 },
    med: { coding: 68, reasoning: 65, general: 68 },
    high: { coding: 82, reasoning: 80, general: 78 },
  },
  reasoning: {
    low: { coding: 0, reasoning: 48, general: 50 },
    med: { coding: 0, reasoning: 65, general: 60 },
    high: { coding: 0, reasoning: 80, general: 72 },
  },
  chat: {
    low: { coding: 0, reasoning: 35, general: 50 },
    med: { coding: 0, reasoning: 45, general: 62 },
    high: { coding: 0, reasoning: 58, general: 75 },
  },
};

export type Recommendation = {
  current: Model; // anchor model from the parsed trace
  recommended: Model | null; // cheapest capable model; null if anchor already optimal
  monthlySaving: number; // positive = saving vs anchor; 0 when recommended is null
  rationale: string;
  caveats: string[];
};

const round2 = (v: number): number => Math.round(v * 100) / 100;

// §4.5 — render the gating floor dimensions (omit coding when 0 = no constraint).
function formatFloor(floor: FloorCell): string {
  const parts: string[] = [];
  if (floor.coding > 0) parts.push(`coding≥${floor.coding}`);
  parts.push(`reasoning≥${floor.reasoning}`);
  parts.push(`general≥${floor.general}`);
  return parts.join(" / ");
}

// §4.6 — caveats from classification confidence + model data quality.
function buildCaveats(
  cls: Classification,
  current: Model,
  recommended: Model | null,
): string[] {
  const caveats: string[] = [];

  if (cls.taskTypeConfidence < 0.5) {
    caveats.push(
      `Task-type confidence is low (${(cls.taskTypeConfidence * 100).toFixed(0)}%) — override the classifier if this doesn't match your workload.`,
    );
  }
  if (cls.complexityConfidence < 0.5) {
    caveats.push(
      `Complexity confidence is low (${(cls.complexityConfidence * 100).toFixed(0)}%) — verify via the override control.`,
    );
  }
  if (recommended?.capability) {
    const c = recommended.capability.confidence;
    if (c.coding === "low" || c.reasoning === "low" || c.general === "low") {
      caveats.push(
        `${recommended.name} has low-confidence benchmark data in at least one domain — treat this recommendation as a starting point, not a guarantee.`,
      );
    }
  }
  if (cls.taskTypeConfidence < 0.5 || cls.complexityConfidence < 0.5) {
    caveats.push(
      "Use the override controls to adjust the classification before acting on this recommendation.",
    );
  }
  if (current.capability) {
    const c = current.capability.confidence;
    if (c.coding === "low" || c.reasoning === "low" || c.general === "low") {
      caveats.push(
        `Anchor model ${current.name} has low-confidence benchmark data — floor comparison may be unreliable.`,
      );
    }
  }

  return caveats;
}

export function recommend(
  p: ParsedRun,
  cls: Classification,
  config: AgentConfig,
): Recommendation {
  // Step 1 — resolve anchor.
  const anchorModel = MODELS.find((m) => m.id === config.modelId);

  // §4.3 — anchor unknown.
  if (!anchorModel) {
    return {
      current: { id: config.modelId, name: config.modelId } as Model,
      recommended: null,
      monthlySaving: 0,
      rationale: `Anchor model "${config.modelId}" is not in the known model catalog — cannot compare.`,
      caveats: ["Add this model to models.ts to enable recommendations."],
    };
  }

  // Step 2 — effective costs for all models (reuse projectCounterfactual; cheapest-first).
  const projections = projectCounterfactual(config, MODELS);

  // Step 3 — anchor cost.
  const anchorProjection = projections.find((proj) => proj.isAnchor);
  // anchorModel exists in MODELS, so its projection always exists.
  const anchorMonthly = anchorProjection
    ? anchorProjection.breakdown.totalPerMonth
    : 0;

  // Step 4 — resolve the floor cell for this (taskType, complexity).
  const floor = CAPABILITY_FLOOR[cls.taskType][cls.complexity];

  // Step 5 — filter to capable models (must clear ALL three floors).
  const capableModels = projections.filter((proj) => {
    const cap = proj.model.capability;
    if (!cap) return false; // no benchmark data → conservative exclude
    return (
      cap.scores.coding >= floor.coding &&
      cap.scores.reasoning >= floor.reasoning &&
      cap.scores.general >= floor.general
    );
  });

  // Step 5.5 — EMPTY GUARD: no model clears the floor (Sub-case B).
  if (capableModels.length === 0) {
    return {
      current: anchorModel,
      recommended: null,
      monthlySaving: 0,
      rationale: `No model in the lineup clears the ${cls.complexity}-${cls.taskType} capability floor (${formatFloor(floor)}); staying on ${anchorModel.name}.`,
      caveats: [
        "No model meets the capability floor for this task — the classification may be too strict; use the override control.",
      ],
    };
  }

  // Step 6 — cheapest capable model (projections already sorted cheapest-first).
  const cheapestCapable = capableModels[0];

  // Step 6.5 — guard: anchor fails floor AND no cheaper capable model exists (Sub-case C).
  if (cheapestCapable.breakdown.totalPerMonth > anchorMonthly) {
    return {
      current: anchorModel,
      recommended: null,
      monthlySaving: 0,
      rationale: `${anchorModel.name} does not clear the ${cls.complexity}-${cls.taskType} capability floor, but no capable alternative is cheaper — switching would increase cost. Manual model selection recommended.`,
      caveats: [
        `Anchor model ${anchorModel.name} does not meet the capability floor for ${cls.complexity} ${cls.taskType} tasks (floor: ${formatFloor(floor)}).`,
        "All models that clear the floor cost more than the current anchor. This may indicate the task complexity is mis-classified — use the override control.",
      ],
    };
  }

  // Step 7 — anchor already optimal (Sub-case A).
  if (cheapestCapable.model.id === anchorModel.id) {
    return {
      current: anchorModel,
      recommended: null,
      monthlySaving: 0,
      rationale: `${anchorModel.name} is already the cheapest model clearing the ${cls.complexity}-${cls.taskType} floor (${formatFloor(floor)}).`,
      caveats: buildCaveats(cls, anchorModel, null),
    };
  }

  // Step 8 — build result (saving guaranteed positive by Step 6.5).
  const monthlySaving = round2(
    anchorMonthly - cheapestCapable.breakdown.totalPerMonth,
  );
  const rationale = `${cls.complexity} ${cls.taskType} task → floor: ${formatFloor(floor)}; cheapest model clearing floor: ${cheapestCapable.model.name} (saves $${monthlySaving}/mo vs ${anchorModel.name}).`;
  const caveats = buildCaveats(cls, anchorModel, cheapestCapable.model);

  return {
    current: anchorModel,
    recommended: cheapestCapable.model,
    monthlySaving,
    rationale,
    caveats,
  };
}
