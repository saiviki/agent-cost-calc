// sync-models.ts — fetches complete model catalog from models.dev and writes the generated
// pricing snapshot consumed by src/lib/models.ts.
//
// Dynamic Pipeline Architecture (see docs/DATA-PIPELINE.md):
//   - Ingests ALL models with valid pricing from models.dev/catalog.json (~200+ models).
//   - Merges curated judgment from scripts/model-catalog.ts when matching sourceId exists.
//   - Automatically infers tier, strengths, capability scores, and multipliers for all other models.
//
// Usage:
//   npm run sync-models                      # fetch + write src/lib/pricing.generated.json
//   npm run sync-models:check                # exit 1 if drift vs checked-in snapshot
//
// Output: src/lib/pricing.generated.json + a human-readable diff to stdout.

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EDITORIAL_CATALOG, type EditorialEntry } from "./model-catalog";
import type { Catalog } from "./models-dev-types";
import {
  costToGenerated,
  pickLabProviderCost,
  type GeneratedPricing,
} from "./models-dev-mappers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const OUTPUT_PATH = join(ROOT, "src", "lib", "pricing.generated.json");
const MODELS_DEV_CATALOG_ENDPOINT = "https://models.dev/catalog.json";

type Snapshot = {
  source: string;
  fetchedAt: string; // ISO 8601
  sourceEndpoint: string;
  models: GeneratedPricing[];
};

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
      `models.dev returned HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`
    );
  }
  const json = (await res.json()) as Catalog;
  if (!json || typeof json !== "object" || !json.providers || !json.models) {
    fail("models.dev response missing `providers` or `models` object");
  }
  return json;
}

function buildSnapshot(
  catalog: Catalog,
  opts: { allowMissing?: boolean; carryForward?: GeneratedPricing[] }
): { snapshot: Snapshot; missing: string[]; carriedForward: string[] } {
  const models: GeneratedPricing[] = [];
  const missing: string[] = [];
  const carriedForward: string[] = [];

  const prevById = new Map((opts.carryForward ?? []).map((m) => [m.id, m]));
  const prevBySourceId = new Map(
    (opts.carryForward ?? []).filter((m) => m.sourceId).map((m) => [m.sourceId, m])
  );

  // Map editorial entries by sourceId and by local id
  const editorialBySourceId = new Map<string, EditorialEntry>();
  const editorialById = new Map<string, EditorialEntry>();
  for (const ed of EDITORIAL_CATALOG) {
    if (ed.sourceId) editorialBySourceId.set(ed.sourceId, ed);
    editorialById.set(ed.id, ed);
  }

  // Deduplicate IDs across all models.dev entries
  const usedIds = new Set<string>();

  const catalogModelKeys = Object.keys(catalog.models).sort();

  for (const sourceId of catalogModelKeys) {
    const metadata = catalog.models[sourceId];
    const costPicked = pickLabProviderCost(catalog, sourceId);

    // Skip models that have no pricing anywhere
    if (!costPicked || !costPicked.cost || ((costPicked.cost.input ?? 0) === 0 && (costPicked.cost.output ?? 0) === 0)) {
      continue;
    }

    const edEntry = editorialBySourceId.get(sourceId);
    let gen = costToGenerated(sourceId, metadata, costPicked, edEntry);

    // Ensure unique local id if there is a collision
    if (usedIds.has(gen.id)) {
      const parts = sourceId.split("/");
      const uniqueId = `${parts[0]}-${parts[1] || gen.id}`;
      gen = { ...gen, id: uniqueId };
    }

    usedIds.add(gen.id);
    models.push(gen);
  }

  // Check if any editorial entries were missing from models.dev catalog and carry forward if available
  for (const ed of EDITORIAL_CATALOG) {
    if (!usedIds.has(ed.id)) {
      const prev = prevById.get(ed.id);
      if (prev) {
        carriedForward.push(ed.id);
        models.push(prev);
        usedIds.add(ed.id);
      } else {
        missing.push(ed.id);
      }
    }
  }

  const snapshot: Snapshot = {
    source: "models.dev /catalog.json",
    fetchedAt: new Date().toISOString(),
    sourceEndpoint: MODELS_DEV_CATALOG_ENDPOINT,
    models,
  };

  return { snapshot, missing, carriedForward };
}

function readExisting(): Snapshot | null {
  try {
    const raw = readFileSync(OUTPUT_PATH, "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

function diffSnapshots(prev: Snapshot | null, next: Snapshot): string[] {
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
        `+ ${id}: added (input=${n.inputPricePerM}, output=${n.outputPricePerM})`
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
      "provider",
    ];
    for (const f of fields) {
      const a = p[f];
      const b = n[f];
      if (a !== b) {
        lines.push(`~ ${id}.${f}: ${String(a)} -> ${String(b)}`);
      }
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) lines.push(`- ${id}: removed`);
  }
  if (lines.length === 0) lines.push("No changes.");
  return lines;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const allowMissing = args.has("--allow-missing");

  const existing = readExisting();

  if (check) {
    const catalog = await fetchCatalog();
    const { snapshot: next } = buildSnapshot(catalog, {
      allowMissing: true,
      carryForward: existing?.models,
    });
    const prev = existing;
    const lines = diffSnapshots(prev, next);
    const hasRealChange = lines.some(
      (l) => l.startsWith("~") || l.startsWith("+") || l.startsWith("-")
    );
    console.log("[sync-models --check] diff vs checked-in snapshot:");
    for (const l of lines) console.log("  " + l);
    if (hasRealChange) {
      console.error(
        "\nDrift detected — run `npm run sync-models` locally and commit the result."
      );
      process.exit(1);
    }
    console.log("Snapshot is up to date.");
    return;
  }

  const catalog = await fetchCatalog();
  const { snapshot, missing, carriedForward } = buildSnapshot(catalog, {
    allowMissing,
    carryForward: existing?.models,
  });

  const prev = existing;
  const lines = diffSnapshots(prev, snapshot);
  console.log("[sync-models] writing src/lib/pricing.generated.json");
  for (const l of lines) console.log("  " + l);
  if (carriedForward.length > 0) {
    console.warn("\n[warn] Carried forward last-known pricing (delisted or pending remap):");
    for (const id of carriedForward) console.warn("  - " + id);
  }

  const json = JSON.stringify(snapshot, null, 2) + "\n";
  writeFileSync(OUTPUT_PATH, json, "utf8");
  console.log(`\nWrote ${snapshot.models.length} models to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
