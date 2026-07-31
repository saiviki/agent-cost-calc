# Draft — models-dev-source

**Status:** awaiting-approval
**Pending action:** write `.omo/plans/models-dev-source.md`
**Intent:** clear
**Review required:** false
**Classify:** Standard (1 new sync impl, 4 file edits, ~16-row editorial remap; clear refactor with one external data contract)

## Request
Replace the OpenRouter source of the generated pricing layer with https://models.dev. Keep the two-layer architecture (editorial + generated) intact.

## Key findings (with paths)

### Consumer side (agent-cost-calc)
- **Two-layer architecture** (clean): editorial layer `scripts/model-catalog.ts` (16 models, fields: tier/strengths/outputMultiplier/capability) is joined at module load in `src/lib/models.ts:91-136` with the generated layer `src/lib/pricing.generated.json` (volatile fields: pricing/context/isOpen/name/provider). Join key is the stable local `id`, NOT `openrouterSlug`. `openrouterSlug` is metadata carried in both layers.
- **Sync script** `scripts/sync-models.ts` (364 lines): fetches OpenRouter `/api/v1/models`, maps per-token string prices → per-1M numbers, applies cache-price heuristics (`KNOWN_CACHE_VENDORS` + `0.1×input`), writes `src/lib/pricing.generated.json`. Supports `--check` (drift detection, exit 1) and `--allow-missing` (carry-forward). npm scripts: `sync-models`, `sync-models:check` (`package.json:15-16`).
- **Snapshot type** (`scripts/sync-models.ts:33-52`): `{ source, fetchedAt, openRouterEndpoint, models: GeneratedPricing[] }`. `GeneratedPricing` fields: `id, openrouterSlug, name, provider, isOpen, contextK, inputPricePerM, outputPricePerM, cacheReadPricePerM?, cacheWritePricePerM?, supportsCache`.
- **`Model` type** consumed by app (`src/lib/models.ts:28-51`): same volatile fields + editorial fields, all read by `calculateCost` (`src/lib/models.ts:187-236`) and surfaced in `src/app/page.tsx`, `src/app/trace/page.tsx`.
- **Tests**: `src/lib/__tests__/recommend.test.ts` etc. use the real `MODELS` catalog and reference stable `id` values (e.g. `claude-opus-4-7`) — they do NOT pin prices or read `openrouterSlug`. Source swap will not break tests as long as `id` stays stable.
- **No `docs/DATA-PIPELINE.md`** despite being referenced in code comments (`scripts/model-catalog.ts:3`, `src/lib/models.ts:55`). Doc debt.
- **Deploy**: `vercel.json` minimal (no scheduled fn / ISR). `next.config.ts` empty. Sync is local-dev only today; no automated cron.

### Source side (models.dev) — confirmed from `sst/models.dev` SDK `packages/sdk/src/types.ts`
- **Three JSON endpoints** (documented on the "How to use" page):
  - `https://models.dev/api.json` → `ProviderMap` (Record<providerId, Provider>); per-provider models with `cost`.
  - `https://models.dev/models.json` → `ModelMetadataMap` (Record<`<lab>/<model>`, ModelMetadata>); **NO pricing** — provider-agnostic metadata only.
  - `https://models.dev/catalog.json` → `{ providers: ProviderMap, models: ModelMetadataMap }` — combined.
- **Official SDK**: `@opencode-ai/models` (type-safe, exports snapshot). An alternative to raw fetch.
- **`Cost` shape** (USD per 1M tokens — matches our `PricePerM` exactly, no conversion):
  ```
  Cost { input, output, reasoning?, cache_read?, cache_write?, input_audio?, output_audio? }
  ModelCost extends Cost { context_over_200k?: Cost, tiers?: CostTier[] }
  ```
- **`ModelMetadata`** fields (no pricing): `id, name, description, family?, attachment?, reasoning?, tool_call?, structured_output?, temperature?, knowledge?, release_date?, last_updated?, modalities?, open_weights, limit {context, input?, output?}, license?, links?, weights?, benchmarks?`.
- **`Model`** (per-provider, in `/api.json`): metadata fields + `cost?: ModelCost` + `limit: Limit` + `status?` + `reasoning_options?` etc.
- **Canonical id format**: `<lab>/<model-slug>` e.g. `anthropic/claude-opus-4-6` (hyphens, not dots — DIFFERENT from OpenRouter's `anthropic/claude-opus-4.7`).
- **Lab slugs differ from OpenRouter vendor slugs**: `xai` (not `x-ai`), `alibaba` (not `qwen`), `meta` (not `meta-llama`), `zhipuai` (not `z-ai`).
- **Data is community TOML** in `github.com/sst/models.dev` — shifts under us; same drift problem OpenRouter had; `--check` stays valuable.
- **Newer model versions present**: Claude Opus 5, Sonnet 5, Grok 4.5, MiniMax-M3, GLM-5.2, GPT-5.6 family, Gemini 3.5/3.6, etc. Several of our 16 editorial rows will NOT have an exact-match models.dev id.

### 16-row editorial remap (openrouterSlug → models.dev canonical id) — needs per-row verification
Known-suspect mismatches (lab slug or version differs):
- `x-ai/grok-4.1-fast` → models.dev lab is `xai`; fast variant may not exist.
- `qwen/qwen3.6-plus` → models.dev lab is `alibaba`.
- `z-ai/glm-5.1` → models.dev lab is `zhipuai`; version is 5.2.
- `meta-llama/llama-3.3-70b-instruct` → models.dev lab is `meta`.
- `minimax/minimax-m2.7` → models.dev has `minimax/MiniMax-M3` (newer).
- `anthropic/claude-opus-4.7`, `anthropic/claude-sonnet-4.6`, `anthropic/claude-haiku-4.5` → models.dev has Claude 5 family; 4.x may or may not be listed.

## Decisions (recommended defaults — surfaced as forks to user)

1. **Source mechanism**: raw JSON via `/catalog.json`, NOT the `@opencode-ai/models` SDK.
   - Why: preserves existing `sync-models.ts` → `pricing.generated.json` architecture, no new runtime dep, `--check` drift gate keeps working. SDK would force npm-bump-and-commit to refresh and changes the architecture more than asked.
2. **Pricing source per model**: the lab's own provider entry in `/catalog.json` (e.g. `providers["anthropic"].models["claude-sonnet-5"].cost`).
   - Why: canonical vendor price, matches what the README cites ("Anthropic / Google official docs"), avoids OpenRouter markups, deterministic per model.
3. **Slug/version mismatch handling**: flag-and-carry-forward. Sync reports each editorial row that has no exact models.dev match; last-known pricing is carried forward so the app keeps rendering. Lineup refresh (Opus 4.7 → Opus 5, etc.) is a separate editorial decision, NOT a side effect of this swap.
4. **Field rename**: `openrouterSlug` → `sourceId` across `model-catalog.ts`, `sync-models.ts`, `models.ts` (`GeneratedPricingEntry`), `pricing.generated.json`. Neutral, future-proof.
5. **Heuristics dropped**: `KNOWN_CACHE_VENDORS` and the `0.1×input` cache-price fallback become unnecessary (models.dev exposes real `cache_read`/`cache_write`). `inferProvider` becomes a lab-slug→display-name map for the new slug grammar. `inferIsOpen` becomes a direct read of `metadata.open_weights`.

## Scope (in)
- Replace fetch source in `scripts/sync-models.ts`: OpenRouter `/api/v1/models` → models.dev `/catalog.json`.
- Remap `GeneratedPricing` field extraction to models.dev `Model.cost` + `ModelMetadata`.
- Pick lab's own provider entry per model for pricing.
- Rename `openrouterSlug` → `sourceId` everywhere; rename snapshot fields `openRouterEndpoint` → `sourceEndpoint`, `source` string updated.
- Remap all 16 editorial rows in `scripts/model-catalog.ts` to models.dev canonical ids where exact match exists; carry-forward + warn where not.
- Drop `KNOWN_CACHE_VENDORS`, `0.1×input` heuristic, OpenRouter-specific `inferProvider`/`inferIsOpen`; replace with models.dev-native equivalents.
- Keep `--check` drift detection and `--allow-missing` carry-forward behavior; update CLI messaging.
- Update README "Lineup" section citation (OpenRouter → models.dev) and the "Verified … against" line.
- Add the missing `docs/DATA-PIPELINE.md` referenced by code comments, documenting the new source.
- Add/adjust unit tests for the new sync mapping logic (pure functions extracted from the script).

## Scope (out / Must-NOT-Have)
- Do NOT refresh the editorial lineup (no Opus 4.7 → Opus 5 bumps, no tier/strength/capability changes). That is a separate editorial decision.
- Do NOT adopt the `@opencode-ai/models` SDK (out unless user overrides).
- Do NOT add a runtime fetch in the Next.js app. Sync stays a local-dev/CI script.
- Do NOT change `Model` type volatile-field names (`inputPricePerM` etc.) — they stay; only the source mapping changes.
- Do NOT touch editorial fields (tier, strengths, outputMultiplier, capability scores).
- Do NOT add scheduled Vercel functions or automated cron — sync stays manual-trigger.
- Do NOT remove `gpt-tokenizer`, `recommend.ts`, counterfactual/replay, or any unrelated subsystem.

## Risks
- **Slug remap coverage**: some of the 16 editorial rows may have no exact models.dev match → carry-forward engaged, pricing goes stale until editorial bumps. Mitigation: sync report lists every carry-forward loudly.
- **Cache price coverage**: models.dev may omit `cache_read`/`cache_write` for some providers we used to infer cache support for. Mitigation: fall back to "cache supported iff `cache_read` present" — cleaner than the old vendor allowlist, but means some rows may lose cache pricing they previously had. Surface in sync report.
- **Schema drift upstream**: models.dev is community TOML; field shapes could shift. Mitigation: keep `--check`, pin to no specific commit (live endpoint), document the dependency in DATA-PIPELINE.md.
- **Per-row pricing-source ambiguity**: "the lab's own provider" assumes the lab appears in `providers[]` for every model. For labs NOT directly distributed (rare), fall back to first provider with a non-zero cost; warn.

## Approach (high level)
1. Verify each of the 16 editorial rows against `catalog.json` (saved locally); produce a remap table (exact / closest / not-found).
2. Refactor `scripts/sync-models.ts`: new fetch (`/catalog.json`), new types (import from a local `types.ts` mirror of the SDK's `ModelMetadata`/`Provider`/`Model`/`Cost`), new mapping logic, renamed snapshot fields. Extract pure mappers for unit testing.
3. Update `scripts/model-catalog.ts`: rename `openrouterSlug` → `sourceId`; populate each row's `sourceId` from the remap table.
4. Update `src/lib/models.ts`: rename `GeneratedPricingEntry.openrouterSlug` → `sourceId`; rename snapshot fields; update header comments.
5. Regenerate `src/lib/pricing.generated.json` via `npm run sync-models --allow-missing`; commit the new snapshot.
6. Update README + add `docs/DATA-PIPELINE.md`.
7. Add unit tests for the new mappers; run full `vitest` suite.
8. Verify `npm run sync-models:check` passes (no drift after commit).

## Approval gate
Awaiting user approval on the four forks above before writing `.omo/plans/models-dev-source.md`. After approval: Metis gap analysis → scaffold plan → append todo batches → final verification wave design.
