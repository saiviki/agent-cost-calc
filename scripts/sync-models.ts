// sync-models.ts — refreshes the curated pricing snapshot from models.dev.
//
// The user-facing lineup is the editorial catalog only. models.dev supplies
// volatile pricing/metadata for those entries. New upstream models are never
// auto-added. See docs/DATA-PIPELINE.md.
//
// Usage:
//   npm run sync-models:refresh   # fetch models.dev and rewrite the snapshot
//   npm run sync-models           # same
//   npm run sync-models:check     # offline, deterministic validation (no network)

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EDITORIAL_CATALOG } from "./model-catalog";
import type { Catalog } from "./models-dev-types";
import {
  costToGenerated,
  labDisplayName,
  markCarriedForward,
  metadataToDisplayName,
  pickEditorialPrice,
  splitSourceId,
  type GeneratedPricing,
} from "./models-dev-mappers";
import {
  formatValidationIssues,
  validatePricingSnapshot,
  type PricingSnapshot,
} from "./validate-pricing-snapshot";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const OUTPUT_PATH = join(ROOT, "src", "lib", "pricing.generated.json");
const MODELS_DEV_CATALOG_ENDPOINT = "https://models.dev/catalog.json";

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(MODELS_DEV_CATALOG_ENDPOINT, {
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) {
    fail(
      `models.dev returned HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`,
    );
  }
  const json = (await res.json()) as Catalog;
  if (!json || typeof json !== "object" || !json.providers || !json.models) {
    fail("models.dev response missing `providers` or `models` object");
  }
  return json;
}

export function buildCuratedSnapshot(
  catalog: Catalog,
  opts: { fetchedAt: string; carryForward?: GeneratedPricing[] },
): {
  snapshot: PricingSnapshot;
  missing: string[];
  carriedForward: string[];
  unresolved: string[];
} {
  const prevById = new Map((opts.carryForward ?? []).map((m) => [m.id, m]));
  const models: GeneratedPricing[] = [];
  const missing: string[] = [];
  const carriedForward: string[] = [];
  const unresolved: string[] = [];

  for (const entry of EDITORIAL_CATALOG) {
    const prev = prevById.get(entry.id);

    if (!entry.sourceId) {
      if (!prev) {
        unresolved.push(entry.id);
        continue;
      }
      carriedForward.push(entry.id);
      models.push(markCarriedForward(prev, { id: entry.id, sourceId: "" }));
      continue;
    }

    const metadata = catalog.models[entry.sourceId];
    const picked = pickEditorialPrice(
      catalog,
      entry.sourceId,
      entry.fallbackProvider,
    );

    if (!picked) {
      missing.push(`${entry.id} (${entry.sourceId})`);
      if (!prev) {
        unresolved.push(entry.id);
        continue;
      }
      carriedForward.push(entry.id);
      const carried = markCarriedForward(prev, {
        id: entry.id,
        sourceId: entry.sourceId,
      });
      if (metadata) {
        carried.name = metadataToDisplayName(metadata, entry.sourceId) || carried.name;
        if (metadata.limit?.context) {
          carried.contextK = Math.round(metadata.limit.context / 1000);
        }
        if (typeof metadata.open_weights === "boolean") {
          carried.isOpen = metadata.open_weights;
        }
        carried.modelDeveloper =
          labDisplayName(splitSourceId(entry.sourceId).lab) || carried.modelDeveloper;
      }
      models.push(carried);
      continue;
    }

    models.push(
      costToGenerated(entry, metadata, picked, {
        fetchedAt: opts.fetchedAt,
        pricingStatus: "live",
      }),
    );
  }

  return {
    snapshot: {
      source: "models.dev /catalog.json",
      fetchedAt: opts.fetchedAt,
      sourceEndpoint: MODELS_DEV_CATALOG_ENDPOINT,
      models,
    },
    missing,
    carriedForward,
    unresolved,
  };
}

function readExisting(): PricingSnapshot | null {
  try {
    const raw = readFileSync(OUTPUT_PATH, "utf8");
    return JSON.parse(raw) as PricingSnapshot;
  } catch {
    return null;
  }
}

function diffSnapshots(prev: PricingSnapshot | null, next: PricingSnapshot): string[] {
  const lines: string[] = [];
  if (!prev) {
    lines.push("No existing snapshot — writing initial pricing.generated.json.");
    return lines;
  }
  const prevById = new Map(prev.models.map((m) => [m.id, m]));
  const nextById = new Map(next.models.map((m) => [m.id, m]));

  for (const [id, n] of nextById) {
    const p = prevById.get(id);
    if (!p) {
      lines.push(
        `+ ${id}: added (input=${n.inputPricePerM}, output=${n.outputPricePerM}, via ${n.pricingProvider})`,
      );
      continue;
    }
    const fields: (keyof GeneratedPricing)[] = [
      "sourceId",
      "inputPricePerM",
      "outputPricePerM",
      "cacheReadPricePerM",
      "cacheWritePricePerM",
      "contextK",
      "isOpen",
      "supportsCache",
      "name",
      "modelDeveloper",
      "pricingProvider",
      "pricingStatus",
    ];
    for (const f of fields) {
      if (p[f] !== n[f]) {
        lines.push(`~ ${id}.${f}: ${String(p[f])} -> ${String(n[f])}`);
      }
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) lines.push(`- ${id}: removed`);
  }
  if (lines.length === 0) lines.push("No changes.");
  return lines;
}

function runCheck(): void {
  const existing = readExisting();
  if (!existing) {
    fail(`Missing ${OUTPUT_PATH}. Run npm run sync-models:refresh.`);
  }
  const issues = validatePricingSnapshot(existing, EDITORIAL_CATALOG);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  console.log("[sync-models --check] offline validation of checked-in snapshot");
  for (const line of formatValidationIssues(issues)) {
    if (line.startsWith("[error]")) console.error("  " + line);
    else console.warn("  " + line);
  }
  if (warnings.length === 0 && errors.length === 0) {
    console.log("  [ok] snapshot schema, coverage, and provenance are valid.");
  }
  if (errors.length > 0) {
    console.error(
      `\n${errors.length} validation error(s). Fix the snapshot or editorial catalog.`,
    );
    process.exit(1);
  }
  console.log(
    `Snapshot is valid (${existing.models.length} curated models, ${warnings.length} warning(s)).`,
  );
}

async function runRefresh(): Promise<void> {
  const existing = readExisting();
  const fetchedAt = new Date().toISOString();
  const catalog = await fetchCatalog();
  const { snapshot, missing, carriedForward, unresolved } = buildCuratedSnapshot(
    catalog,
    { fetchedAt, carryForward: existing?.models },
  );

  if (unresolved.length > 0) {
    fail(
      `No live price and no previous snapshot for: ${unresolved.join(", ")}.\n` +
        `Set sourceId / fallbackProvider in scripts/model-catalog.ts, or seed pricing.generated.json.`,
    );
  }

  const issues = validatePricingSnapshot(snapshot, EDITORIAL_CATALOG);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    for (const line of formatValidationIssues(errors)) console.error(line);
    fail("Refreshed snapshot failed validation.");
  }

  const lines = diffSnapshots(existing, snapshot);
  console.log("[sync-models --refresh] writing src/lib/pricing.generated.json");
  for (const l of lines) console.log("  " + l);
  if (missing.length > 0) {
    console.warn("\n[warn] No direct or configured-fallback price on models.dev:");
    for (const s of missing) console.warn("  - " + s);
  }
  if (carriedForward.length > 0) {
    console.warn("\n[warn] Carried forward last-known pricing:");
    for (const id of carriedForward) console.warn("  - " + id);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${snapshot.models.length} curated models to ${OUTPUT_PATH}`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const refresh = args.has("--refresh") || (!check && args.size === 0);

  if (check && args.has("--refresh")) {
    fail("Pass either --check or --refresh, not both.");
  }
  if (check) {
    runCheck();
    return;
  }
  if (refresh) {
    await runRefresh();
    return;
  }
  fail("Usage: tsx scripts/sync-models.ts --refresh | --check");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
