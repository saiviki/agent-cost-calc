// Phase 2 tokenizer dispatch (docs/RESEARCH-validation-methodology.md §4.3).
// Re-tokenizes text with the target model's tokenizer to get accurate cross-model
// token counts — replacing the heuristic outputMultiplier. HONESTY: only OpenAI
// families have an official client-side tokenizer (gpt-tokenizer, o200k_base for
// GPT-5/o-series, cl100k_base for GPT-4 era). Anthropic Claude 4.x and Google
// Gemini have NO public client-side tokenizer (the Anthropic Count Tokens API
// requires an API key and a backend). For those we return a clearly-flagged
// char-ratio approximation — never a fake 'exact'. The approximation is for
// relative cross-model sizing, NOT a billed-accuracy claim.

// gpt-tokenizer v3.4.0 default `encode` is o200k_base (esm/main re-exports
// encoding/o200k_base). To select an encoding unambiguously we import the
// per-encoding subpaths directly — this is the package's documented way to pick
// o200k_base vs cl100k_base (see node_modules/gpt-tokenizer/package.json `exports`).
import { encode as encodeO200k } from "gpt-tokenizer/encoding/o200k_base";
import { encode as encodeCl100k } from "gpt-tokenizer/encoding/cl100k_base";

// Security DoS guard (CWE-1333): the synchronous BPE encode below runs on the
// main thread. Past this many characters the encoder degrades the tab/UI, so we
// count a prefix and extrapolate instead. 1M chars ≈ 250k tokens — well past any
// realistic single message and still cheap to encode.
const MAX_TOKENIZE_CHARS = 1_000_000;

export type TokenizerMethod = "exact" | "approx";

export type TokenizerFamily =
  | "openai-o200k"
  | "openai-cl100k"
  | "anthropic-approx"
  | "gemini-approx"
  | "unknown";

export type TokenCount = {
  count: number;
  method: TokenizerMethod;
  family: TokenizerFamily;
  source: string; // human-readable citation
};

// Resolve a (modelId, provider) pair to a tokenizer family.
// `provider` is the display string from MODELS[] ("Anthropic" / "OpenAI" / "Google" ...).
//
// Precedence (so GPT-4-era ids reach cl100k, not the OpenAI-provider o200k default):
//   1. id matches the o200k id-regex (gpt-5 / gpt-4o / gpt-4-turbo / o1 / o3 /
//      chatgpt-*)  -> openai-o200k   (id wins regardless of provider string)
//   2. provider OpenAI AND id matches the cl100k id-regex (gpt-4 / gpt-3.5)
//      -> openai-cl100k
//   3. provider OpenAI (id matched neither) -> openai-o200k (current OpenAI default)
//   4. anthropic / claude -> anthropic-approx
//   5. google / gemini   -> gemini-approx
//   6. else unknown
export function tokenizerFamilyForModel(
  modelId: string,
  provider: string,
): TokenizerFamily {
  const id = modelId ?? "";
  const prov = (provider ?? "").toLowerCase();

  const isO200kId = /^(gpt-5|gpt-4o|gpt-4-turbo|o1|o3|chatgpt)/i.test(id);
  if (isO200kId) return "openai-o200k";

  const isCl100kId = /^(gpt-4|gpt-3\.5)/i.test(id);
  if (prov.includes("openai") && isCl100kId) return "openai-cl100k";

  if (prov.includes("openai")) return "openai-o200k";

  if (prov.includes("anthropic") || id.toLowerCase().includes("claude")) {
    return "anthropic-approx";
  }

  if (
    prov.includes("google") ||
    prov.includes("gemini") ||
    id.toLowerCase().includes("gemini")
  ) {
    return "gemini-approx";
  }

  return "unknown";
}

// EXTENSION POINT (P7): the single countTokens(text, modelId, provider)
// dispatch below is the seam. A future API-backed Anthropic tokenizer (calling
// /v1/messages/count_tokens) or a Gemini tokenizer adds a new TokenizerFamily
// (e.g. "anthropic-api") + a branch here that returns method:"exact" — without
// touching any call site (retokenize.ts, retokenizedCost.ts, replayHarness.ts
// all call countTokens). That requires a backend + API key (breaks zero-backend),
// so it is an opt-in product decision, not a default. Until then Anthropic/Gemini
// targets return the flagged char-ratio approx below.
// See docs/SPEC-phase2-retokenization.md §9.
//
// Re-tokenize `text` with the tokenizer selected by (modelId, provider).
// Exact for OpenAI families (real gpt-tokenizer BPE); flagged char-ratio approx
// for Anthropic/Gemini (no official client-side tokenizer exists — see header).
export function countTokens(
  text: string,
  modelId: string,
  provider: string,
): TokenCount {
  const family = tokenizerFamilyForModel(modelId, provider);
  const s = text ?? "";

  // Security (CWE-1333, threat-model §4 DoS): guard the synchronous BPE encode
  // against unbounded input. gpt-tokenizer runs on the main thread; a multi-MB
  // paste would freeze the tab. Cap at MAX_TOKENIZE_CHARS and, when exceeded,
  // count the prefix and extrapolate (good enough for relative cost sizing —
  // the only caller purpose). Approx-branch already caps via ceil(len/ratio).
  if (s.length > MAX_TOKENIZE_CHARS && (family === "openai-o200k" || family === "openai-cl100k")) {
    const prefix = s.slice(0, MAX_TOKENIZE_CHARS);
    const prefixCount =
      family === "openai-o200k"
        ? encodeO200k(prefix).length
        : encodeCl100k(prefix).length;
    const count = Math.ceil((prefixCount * s.length) / MAX_TOKENIZE_CHARS);
    return {
      count,
      method: "approx",
      family,
      source: `gpt-tokenizer ${family === "openai-o200k" ? "o200k_base" : "cl100k_base"} extrapolated from ${MAX_TOKENIZE_CHARS}-char prefix (input ${s.length} chars > cap; DoS guard)`,
    };
  }

  if (family === "openai-o200k") {
    const count = encodeO200k(s).length;
    return {
      count,
      method: "exact",
      family,
      source:
        "gpt-tokenizer o200k_base (official OpenAI encoding for GPT-5/o-series)",
    };
  }

  if (family === "openai-cl100k") {
    const count = encodeCl100k(s).length;
    return {
      count,
      method: "exact",
      family,
      source:
        "gpt-tokenizer cl100k_base (official OpenAI encoding for GPT-4 / GPT-3.5 era)",
    };
  }

  if (family === "anthropic-approx") {
    // No official client-side tokenizer for Claude 4.x. Anthropic averages
    // ~3.5 chars/token on English/code (cross-family variance ±20-30%, per
    // docs/RESEARCH-consumption-multipliers.md Caveat #1).
    const count = Math.max(1, Math.ceil(s.length / 3.5));
    return {
      count,
      method: "approx",
      family,
      source:
        "char-ratio ~3.5 chars/tok — NO official client-side Claude 4.x tokenizer (Count Tokens API needs an API key + backend; out of scope); ±20-30% band",
    };
  }

  if (family === "gemini-approx") {
    // No official client-side Gemini tokenizer. SentencePiece ~4 chars/tok.
    const count = Math.max(1, Math.ceil(s.length / 4.0));
    return {
      count,
      method: "approx",
      family,
      source:
        "char-ratio ~4.0 chars/tok — NO official client-side Gemini tokenizer; ±20-30% band",
    };
  }

  // unknown
  const count = Math.max(1, Math.ceil(s.length / 4.0));
  return {
    count,
    method: "approx",
    family: "unknown",
    source: "char-ratio fallback (unknown provider)",
  };
}

// True iff the target has a real client-side tokenizer (OpenAI families only).
export function isExactForModel(modelId: string, provider: string): boolean {
  return tokenizerFamilyForModel(modelId, provider).startsWith("openai");
}
