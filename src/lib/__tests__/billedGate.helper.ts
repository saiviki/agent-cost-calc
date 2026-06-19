// Operator-facing drop-in for the Phase 1 ±5% billed-accuracy gate.
// NOT a test file (no .test/.spec suffix) — vitest does NOT collect it.
// Imported by billedGate.helper.test.ts and by the operator when they flip a
// billed gate from it.todo to it with their OWN real trace + real invoice.
//
// HONESTY (load-bearing, P4): this helper is a MECHANISM only. It computes
// |reconstructedCost - billedTotal| / billedTotal against whatever the operator
// drops into fixtures/. The ±5% CLAIM is NOT made by this repo — it requires
// ≥3 diverse real traces + real invoices per docs/RESEARCH-validation-methodology.md
// §4.1 and the §4.6 hard rule. See docs/RUNBOOK-billed-accuracy.md.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTrace } from "../parseTrace";
import { reconstructCost, type ProviderKind } from "../reconstructCost";
import { MODELS, type Model } from "../models";

export type BilledGateResult = {
  fixtureName: string;
  provider: ProviderKind;
  sourceModelId: string | null; // resolved MODELS id (null if unresolved)
  runs: number;
  computedCost: number; // reconstructCost total over captured rawCalls
  billedCost: number | null; // billedCostPerRun × runs from expected.json (null = no real invoice yet)
  errorPct: number | null; // |computed - billed| / billed; null when billed null
  targetPct: number; // 0.02 (Phase 1 target, methodology §4.2)
  hardPct: number; // 0.05 (Phase 1 hard gate, methodology §4.6)
  passesTarget: boolean; // errorPct !== null && errorPct <= 0.02
  passesHard: boolean; // errorPct !== null && errorPct <= 0.05
  hasRealInvoice: boolean; // billedCost !== null
  warnings: string[];
};

// Resolve fixtures dir relative to THIS helper file so it is cwd-independent
// (vitest sets cwd to project root, but do not rely on it). The helper lives at
// <root>/src/lib/__tests__/billedGate.helper.ts → THREE levels up reaches <root>,
// then into fixtures/.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "..", "..", "fixtures");

// Read expected.json once, cached.
let expectedCache: Record<string, unknown> | null = null;
function expected(): Record<string, unknown> {
  if (!expectedCache) {
    expectedCache = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "expected.json"), "utf8"),
    ) as Record<string, unknown>;
  }
  return expectedCache;
}

export function runBilledGate(fixtureFileName: string): BilledGateResult {
  const raw = readFileSync(join(FIXTURES_DIR, fixtureFileName), "utf8");
  const parsed = parseTrace(raw);
  const entry =
    (expected()[fixtureFileName] as Record<string, unknown> | undefined) ?? {};
  const billedCostPerRun =
    typeof entry.billedCostPerRun === "number" ? entry.billedCostPerRun : null;

  // CONVENTION: billedCostPerRun is a PER-RUN figure. The gate multiplies it by
  // the number of runs observed in the trace to get the total billed.
  const runs = parsed.runs;
  const billedTotal =
    billedCostPerRun === null ? null : billedCostPerRun * runs;

  // Resolve the model: fuzzy-match parsed.sourceModel against MODELS using the
  // SAME convention parseTrace uses (src===id || src.includes(id) —
  // Anthropic appends date suffixes, matched via includes). Fall back to the
  // expected.json expectedSourceModel if sourceModel is absent/unmatched.
  let model: Model | undefined;
  if (parsed.sourceModel) {
    const src = parsed.sourceModel;
    model = MODELS.find(
      (m) => src === m.id || src.includes(m.id),
    );
  }
  if (!model && typeof entry.expectedSourceModel === "string") {
    model = MODELS.find((m) => m.id === entry.expectedSourceModel);
  }

  const warnings: string[] = [];
  if (!model) {
    const srcLabel =
      parsed.sourceModel ??
      (typeof entry.expectedSourceModel === "string"
        ? entry.expectedSourceModel
        : "?");
    warnings.push(
      `could not resolve a MODELS entry for source '${srcLabel}' — reconstruction needs a priced model`,
    );
  }

  // Reconstruct from captured raw_usage. If the model is unresolved (or no
  // rawCalls captured), the gate is skipped gracefully — computedCost stays NaN,
  // errorPct null, passesHard false. This is the honest "cannot grade" path.
  let computedCost = NaN;
  let provider: ProviderKind = "unknown";
  if (model && parsed.rawCalls && parsed.rawCalls.length > 0) {
    const rec = reconstructCost({ rawCalls: parsed.rawCalls, model });
    computedCost = rec.totalComputed;
    provider = rec.perCall[0]?.provider ?? "unknown";
  }

  const errorPct =
    billedTotal !== null && Number.isFinite(computedCost) && billedTotal > 0
      ? Math.abs(computedCost - billedTotal) / billedTotal
      : null;

  return {
    fixtureName: fixtureFileName,
    provider,
    sourceModelId: model?.id ?? null,
    runs,
    computedCost,
    billedCost: billedTotal,
    errorPct,
    targetPct: 0.02,
    hardPct: 0.05,
    passesTarget: errorPct !== null && errorPct <= 0.02,
    passesHard: errorPct !== null && errorPct <= 0.05,
    hasRealInvoice: billedTotal !== null,
    warnings,
  };
}

// Self-check the runbook points to: run all known (non-underscore) fixtures and
// inspect/print the table. Exported for an operator script (not collected by vitest).
export function runAllBilledGates(): BilledGateResult[] {
  const names = Object.keys(expected()).filter((k) => !k.startsWith("_"));
  return names.map(runBilledGate);
}
