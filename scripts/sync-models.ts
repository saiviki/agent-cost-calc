// sync-models.ts — fetches model data from OpenRouter and writes the generated
// pricing snapshot consumed by src/lib/models.ts.
//
// Two-layer model (see scripts/model-catalog.ts header):
//   - This script writes ONLY the machine-truthable layer: pricing, context
//     window, isOpen, displayName, provider, supportsCache.
//   - Editorial fields (tier, strengths, outputMultiplier, capability) stay in
//     scripts/model-catalog.ts and are NEVER touched here.
//
// Usage:
//   npx tsx scripts/sync-models.ts           # fetch + write src/lib/pricing.generated.json
//   npm run sync-models                       # same, via package.json
//   npx tsx scripts/sync-models.ts --check    # exit 1 if drift vs checked-in snapshot
//   npx tsx scripts/sync-models.ts --allow-missing  # don't fail when an editorial slug isn't on OpenRouter yet
//
// Output: src/lib/pricing.generated.json + a human-readable diff to stdout.
// The CI workflow runs `--check` to fail PRs where the snapshot is stale.
//
// OpenRouter's /api/v1/models endpoint is public and needs no auth for reads.
// Rate limit is generous (~50 req/min anonymous); this script issues ONE call.

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EDITORIAL_CATALOG, type EditorialEntry } from "./model-catalog";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const OUTPUT_PATH = join(ROOT, "src", "lib", "pricing.generated.json");
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/models";

type GeneratedPricing = {
  id: string; // matches EditorialEntry.id — the local stable id
  openrouterSlug: string;
  name: string;
  provider: string;
  isOpen: boolean;
  contextK: number;
  inputPricePerM: number;
  outputPricePerM: number;
  cacheReadPricePerM?: number;
  cacheWritePricePerM?: number;
  supportsCache: boolean;
};

type Snapshot = {
  source: string;
  fetchedAt: string; // ISO 8601
  openRouterEndpoint: string;
  models: GeneratedPricing[];
};

type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string; // per-token, as string
    completion?: string;
    prompt_cache_read?: string | null;
    prompt_cache_write?: string | null;
    request?: string;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
  };
  top_provider?: {
    is_open_source?: boolean;
  };
};

type OpenRouterResponse = {
  data: OpenRouterModel[];
};

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function perTokenToPerM(perTokenStr: string | null | undefined): number | undefined {
  if (perTokenStr == null) return undefined;
  const n = Number(perTokenStr);
  if (!Number.isFinite(n)) return undefined;
  return n * 1_000_000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function inferProvider(slug: string, fallbackName: string): string {
  const vendor = slug.split("/")[0] ?? "";
  const map: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    "x-ai": "xAI",
    deepseek: "DeepSeek",
    moonshotai: "Moonshot",
    qwen: "Alibaba",
    "meta-llama": "Meta",
    "z-ai": "Z.ai",
    minimax: "MiniMax",
    mistralai: "Mistral",
  };
  return map[vendor] ?? vendor ?? fallbackName;
}

// Vendors that definitely expose prompt caching in their billing model.
// Used as a floor when OpenRouter's /api/v1/models doesn't surface cache
// pricing line items for a model we know supports caching.
const KNOWN_CACHE_VENDORS = new Set([
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "mistralai",
  "moonshotai",
]);

function supportsCacheFor(slug: string, cacheReadPricePerM?: number): boolean {
  if (cacheReadPricePerM !== undefined && cacheReadPricePerM > 0) return true;
  const vendor = slug.split("/")[0] ?? "";
  return KNOWN_CACHE_VENDORS.has(vendor);
}

function inferIsOpen(slug: string, orModel: OpenRouterModel): boolean {
  if (typeof orModel.top_provider?.is_open_source === "boolean") {
    return orModel.top_provider.is_open_source;
  }
  const OPEN_VENDORS = new Set([
    "deepseek",
    "qwen",
    "meta-llama",
    "z-ai",
    "minimax",
    "mistralai",
    "moonshotai",
  ]);
  const vendor = slug.split("/")[0] ?? "";
  return OPEN_VENDORS.has(vendor);
}

function deriveDisplayName(entry: EditorialEntry, orModel: OpenRouterModel | undefined): string {
  // OpenRouter's `name` is often "Vendor: Model Name" — strip the vendor prefix
  // so the card shows "Claude Opus 4.7" not "Anthropic: Claude Opus 4.7".
  if (orModel?.name && orModel.name.trim().length > 0) {
    const raw = orModel.name.trim();
    const colonIdx = raw.indexOf(":");
    return colonIdx >= 0 && colonIdx < 25
      ? raw.slice(colonIdx + 1).trim()
      : raw;
  }
  const tail = entry.openrouterSlug.split("/")[1] ?? entry.id;
  return tail
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchOpenRouter(): Promise<Map<string, OpenRouterModel>> {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) {
    fail(`OpenRouter returned HTTP ${res.status}: ${await res.text().catch(() => "<no body>")}`);
  }
  const json = (await res.json()) as OpenRouterResponse;
  if (!json || !Array.isArray(json.data)) {
    fail("OpenRouter response missing `data` array");
  }
  const bySlug = new Map<string, OpenRouterModel>();
  for (const m of json.data) {
    if (m?.id) bySlug.set(m.id, m);
  }
  return bySlug;
}

function buildSnapshot(
  bySlug: Map<string, OpenRouterModel>,
  opts: { allowMissing: boolean; carryForward?: GeneratedPricing[] },
): { snapshot: Snapshot; missing: string[]; carriedForward: string[] } {
  const models: GeneratedPricing[] = [];
  const missing: string[] = [];
  const carriedForward: string[] = [];
  const prevById = new Map((opts.carryForward ?? []).map((m) => [m.id, m]));

  for (const entry of EDITORIAL_CATALOG) {
    const orModel = bySlug.get(entry.openrouterSlug);
    if (!orModel) {
      missing.push(entry.openrouterSlug);
      if (!opts.allowMissing) {
        fail(
          `Editorial slug not found on OpenRouter: '${entry.openrouterSlug}' (local id '${entry.id}').\n` +
            `Pass --allow-missing to emit a snapshot without it, or update openrouterSlug in scripts/model-catalog.ts.`,
        );
      }
      // Carry forward the last-known entry so the app keeps showing real
      // numbers instead of zeros. This keeps a temporarily-delisted model
      // visible until either the vendor re-lists it or editorial removes it.
      const prev = prevById.get(entry.id);
      if (prev) {
        carriedForward.push(entry.id);
        models.push(prev);
      }
      continue;
    }

    const inputPricePerM = perTokenToPerM(orModel.pricing?.prompt) ?? 0;
    const outputPricePerM = perTokenToPerM(orModel.pricing?.completion) ?? 0;
    const cacheReadPricePerM = perTokenToPerM(orModel.pricing?.prompt_cache_read);
    const cacheWritePricePerM = perTokenToPerM(orModel.pricing?.prompt_cache_write);
    // OpenRouter doesn't expose cache pricing uniformly — e.g. Anthropic and
    // OpenAI both support prompt caching but `/api/v1/models` often omits the
    // cache line items. Use the curated KNOWN_CACHE_VENDORS allowlist as a
    // floor (these vendors definitely support cache), then layer any price data
    // OpenRouter did return on top.
    const supportsCache = supportsCacheFor(entry.openrouterSlug, cacheReadPricePerM);
    // Apply per-vendor cache-pricing heuristics when OpenRouter didn't surface
    // the cache line items. Sources: README "Notes" section, Anthropic docs
    // (cache_read = 0.10 × input, cache_write_5min = 1.25 × input),
    // OpenAI/Google (~0.10 × input for cached reads).
    const vendor = entry.openrouterSlug.split("/")[0] ?? "";
    let resolvedCacheRead = cacheReadPricePerM;
    let resolvedCacheWrite = cacheWritePricePerM;
    if (supportsCache && resolvedCacheRead === undefined) {
      resolvedCacheRead = round4(inputPricePerM * 0.1);
      if (vendor === "anthropic") {
        resolvedCacheWrite = round4(inputPricePerM * 1.25);
      }
    }

    models.push({
      id: entry.id,
      openrouterSlug: entry.openrouterSlug,
      name: deriveDisplayName(entry, orModel),
      provider: inferProvider(entry.openrouterSlug, orModel.name),
      isOpen: inferIsOpen(entry.openrouterSlug, orModel),
      contextK: Math.round((orModel.context_length ?? 0) / 1000),
      inputPricePerM,
      outputPricePerM,
      cacheReadPricePerM: supportsCache ? resolvedCacheRead : undefined,
      cacheWritePricePerM: supportsCache ? resolvedCacheWrite : undefined,
      supportsCache,
    });
  }

  const snapshot: Snapshot = {
    source: "OpenRouter /api/v1/models",
    fetchedAt: new Date().toISOString(),
    openRouterEndpoint: OPENROUTER_ENDPOINT,
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
      lines.push(`+ ${id}: added (input=${n.inputPricePerM}, output=${n.outputPricePerM})`);
      continue;
    }
    const fields: (keyof GeneratedPricing)[] = [
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
    // Re-fetch and compare against the checked-in snapshot. Fail on drift so
    // CI catches a stale snapshot before merge.
    const bySlug = await fetchOpenRouter();
    const { snapshot: next } = buildSnapshot(bySlug, {
      allowMissing: true,
      carryForward: existing?.models,
    });
    const prev = existing;
    const lines = diffSnapshots(prev, next);
    const hasRealChange = lines.some((l) => l.startsWith("~") || l.startsWith("+") || l.startsWith("-"));
    console.log("[sync-models --check] diff vs checked-in snapshot:");
    for (const l of lines) console.log("  " + l);
    if (hasRealChange) {
      console.error("\nDrift detected — run `npm run sync-models` locally and commit the result.");
      process.exit(1);
    }
    console.log("Snapshot is up to date.");
    return;
  }

  const bySlug = await fetchOpenRouter();
  const { snapshot, missing, carriedForward } = buildSnapshot(bySlug, {
    allowMissing,
    carryForward: existing?.models,
  });

  const prev = existing;
  const lines = diffSnapshots(prev, snapshot);
  console.log("[sync-models] writing src/lib/pricing.generated.json");
  for (const l of lines) console.log("  " + l);
  if (missing.length > 0) {
    console.warn("\n[warn] Editorial slugs not found on OpenRouter:");
    for (const s of missing) console.warn("  - " + s);
  }
  if (carriedForward.length > 0) {
    console.warn("\n[warn] Carried forward last-known pricing (vendor delisted):");
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
