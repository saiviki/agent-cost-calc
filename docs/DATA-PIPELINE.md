# Pricing data pipeline

The estimator shows a **curated lineup**, not the full models.dev catalog.

## Layers

1. **Editorial** (`scripts/model-catalog.ts`) — lineup membership, stable local ids, tier, strengths, verbosity multipliers, optional capability scores, and optional `fallbackProvider`.
2. **Generated** (`src/lib/pricing.generated.json`) — volatile fields from [models.dev/catalog.json](https://models.dev/catalog.json): display name, context window, open-weights flag, prices, cache support, and provenance.

`src/lib/models.ts` joins the two at module load. Editorial wins for judgment fields. Generated wins for prices and metadata.

## Provenance

Each generated row records:

| Field | Meaning |
|---|---|
| `sourceId` | Explicit models.dev model id (`lab/slug`). Empty = no live mapping. |
| `modelDeveloper` | Lab that trained the model (from `sourceId`). |
| `pricingProvider` | Host whose listed price was selected. |
| `pricingStatus` | `live` or `carried-forward`. |
| `pricingFetchedAt` | When this row's live price was last observed. |

Provider selection is deterministic:

1. The lab's own models.dev provider listing.
2. The editorial `fallbackProvider`, if set.
3. Otherwise the last committed price is carried forward (or refresh fails if none exists).

The first alphabetically sorted host is **never** used as a silent fallback. The UI shows `priced via {pricingProvider}` when that host is not the developer, and a **carried-forward** badge when the row is stale.

## Commands

```bash
npm run sync-models:refresh   # network: fetch models.dev, rewrite curated snapshot
npm run sync-models           # same
npm run sync-models:check     # offline: validate committed snapshot (CI)
```

`sync-models:check` does **not** call models.dev. It checks schema, unique ids, editorial coverage, finite non-negative prices, provenance fields, and carried-forward markers. Unrelated PRs must not fail because models.dev changed after the commit.

## Refresh ownership

- Operator runs `npm run sync-models:refresh` locally, reviews every price/source change, then commits `src/lib/pricing.generated.json`.
- Suggested cadence: weekly, or when a lineup sourceId is remapped.
- The scheduled/manual GitHub workflow may fetch live models.dev and **report** drift. Regular PR CI only runs the offline check.

## Missing-mapping policy

- Live mapping requires an explicit `sourceId`.
- Empty `sourceId` is always carried-forward.
- A mapped `sourceId` with no lab price and no `fallbackProvider` is carried-forward. Current cases:
  - `grok-4.1-fast` → `xai/grok-4.1-fast` (metadata exists; no provider lists a price). Not remapped to Grok 4.3/4.5/4.6.
  - `llama-3.3-70b` → `meta/llama-3.3-70b-instruct` (Meta has no list price; host quotes diverge ~$0.13–$1.25). No fallback is configured.
- Ambiguous names are not inferred. Do not point a lineup id at a different generation without an editorial decision.
- Refresh warns on carry-forwards and fails if a mapped entry has no live price **and** no previous snapshot row.

## What is not generated

Tiers, strengths, output multipliers, and capability scores are editorial only. Sync does not infer them for uncurated models, and the snapshot does not ingest the full upstream catalog.
