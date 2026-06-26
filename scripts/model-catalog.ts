// Editorial catalog — the HUMAN-authored layer of the model data pipeline.
//
// Two-layer model (see docs/DATA-PIPELINE.md):
//   1. THIS FILE (editorial):     lineup membership, tier, specialization,
//                                  outputMultiplier, capability scores.
//                                 Human judgment. Checked in. NOT auto-generated.
//   2. pricing.generated.json:    pricing, context window, isOpen, displayName.
//                                 Machine-truthable. Auto-written by sync-models.ts
//                                  from OpenRouter's /api/v1/models.
//
// The two are joined in src/lib/models.ts at module load. Editorial wins for
// judgment fields; generated wins for volatile fields. New OpenRouter models
// that aren't listed here surface as a warning in the sync report — they are
// NEVER silently added (lineup curation is intentional, see README).
//
// `openrouterSlug` is the join key — it must match the `id` field in
// OpenRouter's /api/v1/models response. Update it if a slug changes.

import type { Tier, Strength, CapabilityConfidence } from "../src/lib/models";

export type EditorialEntry = {
  /** Local id used throughout the app. Stable across slug renames. */
  id: string;
  /** OpenRouter model id (the `id` field in /api/v1/models). */
  openrouterSlug: string;
  tier: Tier;
  strengths: Strength[];
  /**
   * Effective output-token verbosity multiplier vs Claude Sonnet 4.6
   * non-reasoning = 1.0. Source: Artificial Analysis Intelligence Index.
   * Manual — this is the editorial heartbeat of the project.
   */
  outputMultiplier: number;
  multiplierSource: string;
  multiplierConfidence: "high" | "med" | "low";
  capability?: {
    scores: { coding: number; reasoning: number; general: number };
    confidence: {
      coding: CapabilityConfidence;
      reasoning: CapabilityConfidence;
      general: CapabilityConfidence;
    };
  };
};

export const EDITORIAL_CATALOG: EditorialEntry[] = [
  // ── FRONTIER ──
  {
    id: "claude-opus-4-7",
    openrouterSlug: "anthropic/claude-opus-4.7",
    tier: "frontier",
    strengths: ["coding", "reasoning"],
    outputMultiplier: 7.9,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — adaptive reasoning, max",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 92, reasoning: 90, general: 88 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
  },
  {
    id: "claude-sonnet-4-6",
    openrouterSlug: "anthropic/claude-sonnet-4.6",
    tier: "frontier",
    strengths: ["coding", "general"],
    outputMultiplier: 1.0,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — non-reasoning (baseline)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 85, reasoning: 74, general: 82 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
  },
  {
    id: "gpt-5.5",
    openrouterSlug: "openai/gpt-5.5",
    tier: "frontier",
    strengths: ["reasoning"],
    outputMultiplier: 5.4,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — xhigh reasoning effort",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 91, reasoning: 91, general: 90 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
  },
  {
    id: "gemini-3.1-pro",
    openrouterSlug: "google/gemini-3.1-pro-preview",
    tier: "frontier",
    strengths: ["multimodal", "long-context", "reasoning"],
    outputMultiplier: 4.1,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — reasoning preview (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 85, reasoning: 92, general: 87 },
      confidence: { coding: "high", reasoning: "high", general: "high" },
    },
  },
  {
    id: "deepseek-v4-pro",
    openrouterSlug: "deepseek/deepseek-v4-pro",
    tier: "frontier",
    strengths: ["reasoning", "coding"],
    outputMultiplier: 13.6,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — reasoning, max effort",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 88, reasoning: 82, general: 78 },
      confidence: { coding: "high", reasoning: "high", general: "med" },
    },
  },
  {
    id: "kimi-k2.6",
    openrouterSlug: "moonshotai/kimi-k2.6",
    tier: "frontier",
    strengths: ["reasoning", "long-context"],
    outputMultiplier: 12.1,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — always-on reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 84, reasoning: 80, general: 75 },
      confidence: { coding: "high", reasoning: "high", general: "med" },
    },
  },
  // ── MID ──
  {
    id: "claude-haiku-4-5",
    openrouterSlug: "anthropic/claude-haiku-4.5",
    tier: "mid",
    strengths: ["fast", "coding"],
    outputMultiplier: 0.59,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — non-reasoning",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 50, reasoning: 58, general: 65 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
  },
  {
    id: "gpt-5.4-mini",
    openrouterSlug: "openai/gpt-5.4-mini",
    tier: "mid",
    strengths: ["fast", "general"],
    outputMultiplier: 0.17,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — non-reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 66, reasoning: 60, general: 70 },
      confidence: { coding: "low", reasoning: "med", general: "med" },
    },
  },
  {
    id: "gemini-3-flash",
    openrouterSlug: "google/gemini-3-flash-preview",
    tier: "mid",
    strengths: ["multimodal", "fast", "long-context"],
    outputMultiplier: 5.1,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 72, reasoning: 70, general: 72 },
      confidence: { coding: "high", reasoning: "med", general: "med" },
    },
  },
  {
    id: "grok-4.1-fast",
    // NOTE: this exact slug is not currently in OpenRouter's /api/v1/models
    // (xAI's lineup has moved to grok-4.3). The sync script will skip it with a
    // warning and `--allow-missing`. Pricing stays in pricing.generated.json
    // (manually maintained for this model) until xAI re-lists a fast variant.
    openrouterSlug: "x-ai/grok-4.1-fast",
    tier: "mid",
    strengths: ["long-context", "fast"],
    outputMultiplier: 0.31,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — non-reasoning, fast variant",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 58, reasoning: 68, general: 65 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
  },
  {
    id: "qwen-3.6-plus",
    openrouterSlug: "qwen/qwen3.6-plus",
    tier: "mid",
    strengths: ["coding", "general"],
    outputMultiplier: 7.1,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — reasoning (default); variant mixing on AA",
    multiplierConfidence: "med",
    capability: {
      scores: { coding: 78, reasoning: 76, general: 73 },
      confidence: { coding: "high", reasoning: "high", general: "med" },
    },
  },
  // ── BUDGET ──
  {
    id: "glm-5.1",
    openrouterSlug: "z-ai/glm-5.1",
    tier: "budget",
    strengths: ["coding", "long-context"],
    outputMultiplier: 1.0,
    multiplierSource:
      "placeholder: no reasoning-mode data on Artificial Analysis (2026-05-30)",
    multiplierConfidence: "low",
    capability: {
      scores: { coding: 72, reasoning: 68, general: 65 },
      confidence: { coding: "med", reasoning: "med", general: "low" },
    },
  },
  {
    id: "deepseek-v4-flash",
    openrouterSlug: "deepseek/deepseek-v4-flash",
    tier: "budget",
    strengths: ["fast", "general"],
    outputMultiplier: 17.1,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — reasoning, max effort",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 68, reasoning: 62, general: 58 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
  },
  {
    id: "llama-3.3-70b",
    openrouterSlug: "meta-llama/llama-3.3-70b-instruct",
    tier: "budget",
    strengths: ["general"],
    outputMultiplier: 0.27,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — non-reasoning",
    multiplierConfidence: "med",
    capability: {
      scores: { coding: 52, reasoning: 48, general: 55 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
  },
  {
    id: "minimax-m2.7",
    openrouterSlug: "minimax/minimax-m2.7",
    tier: "budget",
    strengths: ["general"],
    outputMultiplier: 6.2,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — reasoning (default)",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 58, reasoning: 55, general: 56 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
  },
  {
    id: "mistral-large-2",
    openrouterSlug: "mistralai/mistral-large-2512",
    tier: "budget",
    strengths: ["general"],
    outputMultiplier: 0.19,
    multiplierSource:
      "Artificial Analysis Intelligence Index v4.0 — confirmed 2026-05-30 — non-reasoning",
    multiplierConfidence: "high",
    capability: {
      scores: { coding: 60, reasoning: 52, general: 60 },
      confidence: { coding: "med", reasoning: "med", general: "med" },
    },
  },
];
