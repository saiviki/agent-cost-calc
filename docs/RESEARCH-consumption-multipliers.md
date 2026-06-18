# Output-Token Verbosity Multipliers — Research Findings

> Researched: 2026-05-30 | Revised: 2026-05-30 (gate-fix pass)
> Baseline: **Claude Sonnet 4.6 (non-reasoning) = 1.0**
> Primary source: Artificial Analysis Intelligence Index v4.0 output-token counts (measured, not estimated)
> Secondary: Anthropic/OpenAI reasoning-token docs, provider announcements

---

## Methodology

**What we're measuring**: relative output-token verbosity — how many output tokens a model emits to complete an equivalent agent task, compared to Claude Sonnet 4.6 non-reasoning.

**Source data**: Artificial Analysis measures raw output tokens generated across their Intelligence Index benchmark suite. This is the closest available proxy for "tokens emitted per unit of agent work." The raw counts are absolute (millions of tokens across the full eval suite), so multipliers are computed as:

```
outputMultiplier = model_raw_tokens / claude_sonnet_4_6_nonreasoning_tokens
```

**Baseline anchor**: Claude Sonnet 4.6 (non-reasoning) generated **14M tokens** on the Intelligence Index.
Source: [artificialanalysis.ai/models/claude-sonnet-4-6](https://artificialanalysis.ai/models/claude-sonnet-4-6) — confirmed by direct page fetch 2026-05-30.

**Variant selection policy**: Each model ID in `models.ts` is mapped to the Artificial Analysis variant that best represents how the model is typically deployed in agent workloads (see "Variant notes" column). Reasoning models are mapped to their **default/adaptive** configuration unless the model is primarily a non-reasoning model.

**Caveats**:
1. The Intelligence Index is a fixed benchmark suite, not an open-ended agent task distribution. Real agent workloads may shift these ratios ±20-30%.
2. Models with "reasoning" labels emit hidden chain-of-thought tokens that are billed but not returned in the response body. All counts below include these thinking tokens where applicable.
3. GLM-5.1 (Reasoning): Artificial Analysis shows verbosity = N/A (no token count available for the reasoning variant). The non-reasoning variant (76M, 5.43x) is used as a floor estimate with low confidence. Reasoning mode would likely be higher but is not measurable from this source.
4. Multipliers above ~5x are driven by extended thinking. At high task complexity, these can reach 8-10x. At simple task complexity they may drop to 1.5-2x. The table represents a reasonable mid-point for mixed agent workloads.

---

## Results Table

| Model ID | Name | Raw tokens (M) | Baseline (M) | outputMultiplier | Variant used | Confidence | Source |
|---|---|---|---|---|---|---|---|
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 14 | 14 | **1.00** | Non-reasoning (baseline) | high | artificialanalysis.ai/models/claude-sonnet-4-6 |
| `claude-opus-4-7` | Claude Opus 4.7 | 110 | 14 | **7.86** | Adaptive reasoning, max effort | high | artificialanalysis.ai/models/claude-opus-4-7 |
| `gpt-5.5` | GPT-5.5 | 75 | 14 | **5.36** | xhigh reasoning effort (default flagship) | high | artificialanalysis.ai/models/gpt-5-5 |
| `gemini-3.1-pro` | Gemini 3.1 Pro | 57 | 14 | **4.07** | Reasoning preview (default) | high | artificialanalysis.ai/models/gemini-3-1-pro-preview |
| `deepseek-v4-pro` | DeepSeek V4 Pro | 190 | 14 | **13.57** | Reasoning, max effort | high | artificialanalysis.ai/models/deepseek-v4-pro |
| `kimi-k2.6` | Kimi K2.6 | 170 | 14 | **12.14** | Reasoning (default) | high | artificialanalysis.ai/models/kimi-k2-6 |
| `claude-haiku-4-5` | Claude Haiku 4.5 | 8.3 | 14 | **0.59** | Non-reasoning | high | artificialanalysis.ai/models/claude-4-5-haiku |
| `gpt-5.4-mini` | GPT-5.4 mini | 2.4 | 14 | **0.17** | Non-reasoning (default) | high | artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning |
| `gemini-3-flash` | Gemini 3 Flash | 72 | 14 | **5.14** | Reasoning (default) | high | artificialanalysis.ai/models/gemini-3-flash-reasoning |
| `grok-4.1-fast` | Grok 4.1 Fast | 4.4 | 14 | **0.31** | Non-reasoning (fast variant) | high | artificialanalysis.ai/models/grok-4-1-fast |
| `qwen-3.6-plus` | Qwen 3.6 Plus | 100 | 14 | **7.14** | Reasoning (default) | med | artificialanalysis.ai/models/qwen3-6-plus |
| `glm-5.1` | GLM 5.1 | 76 (non-reasoning floor) | 14 | **1.0 (placeholder)** | Reasoning variant N/A on AA; non-reasoning floor = 5.43x (see GLM note) | low | artificialanalysis.ai/models/glm-5-1-non-reasoning |
| `deepseek-v4-flash` | DeepSeek V4 Flash | 240 | 14 | **17.14** | Reasoning, max effort | high | artificialanalysis.ai/models/deepseek-v4-flash |
| `llama-3.3-70b` | Llama 3.3 70B | 3.8 | 14 | **0.27** | Non-reasoning | med | artificialanalysis.ai/models/llama-3-3-instruct-70b |
| `minimax-m2.7` | MiniMax M2.7 | 87 | 14 | **6.21** | Reasoning (default) | high | artificialanalysis.ai/models/minimax-m2-7 |
| `mistral-large-2` | Mistral Large 2 | 2.6 | 14 | **0.19** | Non-reasoning | high | artificialanalysis.ai/models/mistral-large-2 |

---

## Rounded multipliers for `models.ts`

Proposed values to apply to `models.ts` during implementation (the `outputMultiplier` field is **added in the build**, not yet present in `src/`). Rounded to 2 significant figures to avoid false precision:

```
claude-opus-4-7:   7.9   (reasoning, adaptive/max — high confidence)
claude-sonnet-4-6: 1.0   (baseline)
gpt-5.5:           5.4   (xhigh reasoning — high confidence)
gemini-3.1-pro:    4.1   (reasoning preview — high confidence)
deepseek-v4-pro:   13.6  (reasoning max — high confidence; non-reasoning mode unverified/est.)
kimi-k2.6:         12.1  (reasoning default — high confidence)
claude-haiku-4-5:  0.59  (non-reasoning, concise — high confidence)
gpt-5.4-mini:      0.17  (non-reasoning mode — high confidence; xhigh-reasoning ≈17x is unverified/est.)
gemini-3-flash:    5.1   (reasoning default — high confidence)
grok-4.1-fast:     0.31  (non-reasoning fast mode — high confidence)
qwen-3.6-plus:     7.1   (reasoning default — medium confidence)
glm-5.1:           1.0   (reasoning variant: no AA data; non-reasoning floor 5.43x but model is deployed as reasoning — placeholder, low confidence)
deepseek-v4-flash: 17.1  (reasoning max — high confidence; non-reasoning unverified/est.)
llama-3.3-70b:     0.27  (non-reasoning, very concise — medium confidence)
minimax-m2.7:      6.2   (reasoning, self-evolving default — high confidence)
mistral-large-2:   0.19  (non-reasoning, very concise — high confidence)
```

> **GLM-5.1 note**: The reasoning variant shows verbosity = N/A on Artificial Analysis (no Intelligence Index token count collected). The non-reasoning variant measured 76M tokens (5.43x floor). Since `models.ts` deploys GLM-5.1 as a reasoning/coding model (Z.ai describes it as evaluating results "hundreds of times"), the true multiplier is likely 5-10x but is unverifiable from current public data. The placeholder 1.0 is used in the codebase with `confidence: "low"` pending a direct measurement source. Do not represent this as a measured figure.

---

## Model-by-model notes

### Claude Opus 4.7 (7.9x)
Adaptive reasoning enabled by default via the API. The non-reasoning variant emits 12M tokens (0.86x vs Sonnet baseline), but most agent deployments use reasoning mode for the quality delta. 110M tokens on Intelligence Index vs 14M baseline = 7.86x. Source: Anthropic docs confirm budget_tokens deprecated in favor of adaptive thinking on claude-opus-4-7; Artificial Analysis confirms 110M token count.

### GPT-5.5 (5.4x)
Measured at xhigh reasoning effort (the flagship configuration): **75M tokens / 5.36x** — this is the only effort tier published on the cited AA page and is the figure used for the multiplier.
⚠️ **ESTIMATED (unverified)**: lower effort tiers (high/medium/low) are **not published** on the AA page and no per-tier token counts are sourced. Reduced effort will lower verbosity, but the per-tier splits must NOT be treated as measured. Source (xhigh only): artificialanalysis.ai/models/gpt-5-5.

### Gemini 3.1 Pro (4.1x)
Verbosity rating 3/4 on Artificial Analysis. Generates 57M tokens vs 35M average for reasoning models. Described as "somewhat verbose." Source: artificialanalysis.ai/models/gemini-3-1-pro-preview.

### DeepSeek V4 Pro (13.6x)
Reasoning max effort: 190M tokens (verbosity 4/4) — **verified**. Extremely verbose — over 4x the reasoning-model average (42M). ⚠️ **ESTIMATED (unverified)**: AA references a non-reasoning variant but does **not publish** its token count; the ~1.0x non-reasoning figure is an unsourced estimate, not measured. Production agent deployments using the reasoning model should budget for 10-14x Sonnet-equivalent output spend. Source (reasoning max, 190M): artificialanalysis.ai/models/deepseek-v4-pro.

### Kimi K2.6 (12.1x)
170M tokens on Intelligence Index, verbosity rank #67/87 (very verbose). Reasoning is always-on in K2.6. Primary source confirmed by direct page fetch 2026-05-30. Source: artificialanalysis.ai/models/kimi-k2-6.

**Removed claim**: A previous version of this document attributed a "2-2.5x token use compared to other models" comparison to deepinfra.com/blog/kimi-k2-6-pricing-guide-deployment-tradeoffs. Direct fetch of that page confirmed no such comparison exists there. The claim has been removed. The 170M AA figure stands as the sole confirmed source.

### Claude Haiku 4.5 (0.59x)
Non-reasoning, fast model. 8.3M tokens vs 14M baseline = 0.59x. Artificial Analysis notes it is "somewhat verbose" within its non-reasoning tier (median 7.9M for that tier) but still below the Sonnet 4.6 absolute count. Good for high-volume low-complexity agent steps. Source: artificialanalysis.ai/models/claude-4-5-haiku.

### GPT-5.4 mini (0.17x)
Non-reasoning default: 2.4M tokens — extremely concise. Note: at xhigh reasoning effort GPT-5.4 mini reaches 240M tokens (17x). The multiplier here reflects the default non-reasoning deployment mode, which is the primary use case for a "mini" model. Source: artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning.

### Gemini 3 Flash (5.1x)
Reasoning mode default: 72M tokens. Verbosity is high despite being a "flash" model — Google's Flash line uses reasoning by default in Gemini 3 generation. Source: artificialanalysis.ai/models/gemini-3-flash-reasoning.

### Grok 4.1 Fast (0.31x)
Non-reasoning fast variant: 4.4M tokens, rated "very concise" by Artificial Analysis (average for its tier: 7.8M). The fast/non-thinking mode is the defining characteristic of this model ID. Source: artificialanalysis.ai/models/grok-4-1-fast.

### Qwen 3.6 Plus (7.1x)
Reasoning mode: 100M tokens vs 35M reasoning-tier average. Medium confidence because the Artificial Analysis page for this exact model ID mixes thinking/non-thinking results; the 100M figure is the reasoning (default) mode. Non-thinking mode would be significantly lower (~0.5-1.0x). Source: artificialanalysis.ai/models/qwen3-6-plus.

### GLM 5.1 (placeholder: 1.0, low confidence)
**Status: no reliable reasoning-mode measurement available.**

Artificial Analysis confirms verbosity = N/A for the GLM-5.1 Reasoning variant — no Intelligence Index output token count has been collected. Confirmed by direct page fetch 2026-05-30.

The non-reasoning variant (artificialanalysis.ai/models/glm-5-1-non-reasoning) generated **76M tokens** (5.43x vs Sonnet baseline). This is a floor estimate only — GLM-5.1 in `models.ts` is deployed as a reasoning/coding model (Z.ai describes it as evaluating intermediate results "hundreds of times before delivering final output"), so the actual reasoning-mode verbosity is almost certainly higher than 5.43x, but cannot be quantified from current public data.

A placeholder of **1.0 with `confidence: "low"`** is used in the codebase. This is explicitly marked as estimated/unmeasured. Do not represent it as a measured or high-confidence figure.

If a direct measurement becomes available (via AA Intelligence Index for the reasoning variant, or an independent benchmark), this should be replaced immediately.

Source: artificialanalysis.ai/models/glm-5-1 (N/A confirmed); artificialanalysis.ai/models/glm-5-1-non-reasoning (76M confirmed); deeplearning.ai/the-batch/z-ais-glm-5-1 (qualitative description of reasoning behavior).

### DeepSeek V4 Flash (17.1x)
Reasoning max effort: 240M tokens — the highest verbosity of any model in the lineup (**verified**). This is a reasoning-first budget model where the reasoning overhead dominates the token count. ⚠️ **ESTIMATED (unverified)**: the non-reasoning token count is **not published** on AA — the ~0.79x non-reasoning figure is an unsourced estimate. Source (reasoning max, 240M): artificialanalysis.ai/models/deepseek-v4-flash.

### Llama 3.3 70B (0.27x)
Non-reasoning open model: 3.8M tokens, rated "very concise" by Artificial Analysis (average for its tier: 6.5M). Medium confidence because this is Llama 3.3, not a newer release; the model.ts lineup uses this as the budget open baseline. Source: artificialanalysis.ai/models/llama-3-3-instruct-70b.

### MiniMax M2.7 (6.2x)
Reasoning default: 87M tokens, verbosity 4/4. MiniMax M2.7 uses a self-evolving training approach that tends to produce longer reasoning chains. Source: artificialanalysis.ai/models/minimax-m2-7.

### Mistral Large 2 (0.19x)
Non-reasoning: 2.6M tokens, verbosity 1/4 — "very concise." Notably terse for a frontier-class model. Note: this is Mistral Large 2 (Nov 2024), not the newer Mistral Large 3. Source: artificialanalysis.ai/models/mistral-large-2.

---

## Design considerations for the cost calculator

1. **Dual-mode models (reasoning spread)**: DeepSeek V4 Pro and Flash show enormous *reasoning-mode* verbosity (13.6x / 17.1x — both **verified**). Their *non-reasoning* multipliers are **UNVERIFIED estimates** (no published token counts). Therefore: default to the **verified reasoning multiplier**; do NOT build a "reasoning mode toggle" on the unverified non-reasoning numbers until those are independently sourced. This recommendation is explicitly contingent on sourcing the non-reasoning figures.

2. **GPT-5.4 mini range**: 0.17x (non-reasoning) to 17x (xhigh reasoning). The 0.17x default is correct for "mini" use cases but misleads if the user enables heavy reasoning.

3. **Kimi and DeepSeek flash at >12x**: These numbers mean that at equivalent task complexity, these models can cost 12-17x more in output tokens than Sonnet 4.6 despite lower per-token rates. The cost calculator should surface effective cost-per-task, not just per-token rate.

4. **Haiku and Grok Fast at <0.6x**: These are the genuinely terse models — suitable for high-frequency low-complexity agent steps where output verbosity is controllable.

5. **GLM-5.1 uncertainty**: Surface as "output multiplier unknown — placeholder 1.0" in the UI rather than silently using 1.0. Consider a UI warning badge for low-confidence models.

---

## Gate-fix audit log (2026-05-30)

Two prior blocking issues resolved in this revision:

**Issue 1 — GLM-5.1 (prior: 7.86x, high/med confidence contradiction)**
- Prior doc cited artificialanalysis.ai/models/glm-5-1 for 110M tokens and listed confidence as "med" in model notes but "high" in the table header — a direct contradiction.
- Direct page fetch confirmed: AA shows verbosity = N/A for GLM-5.1 Reasoning. No token count is published.
- The 110M figure has no confirmed source and has been removed.
- Resolution: multiplier reset to 1.0 placeholder, confidence = "low", non-reasoning floor (76M / 5.43x) documented separately as a lower bound only.

**Issue 2 — Kimi K2.6 secondary "2-2.5x" claim (prior: attributed to deepinfra.com/blog/kimi-k2-6-pricing-guide-deployment-tradeoffs)**
- Direct page fetch confirmed: the DeepInfra Kimi K2.6 blog post contains no token-use comparison to other models whatsoever.
- The attributed claim was fabricated and has been removed entirely.
- Resolution: 170M / 12.14x from Artificial Analysis stands as the sole confirmed source.

---

## Sources

- [Artificial Analysis — Claude Sonnet 4.6](https://artificialanalysis.ai/models/claude-sonnet-4-6)
- [Artificial Analysis — Claude Opus 4.7 (max)](https://artificialanalysis.ai/models/claude-opus-4-7)
- [Artificial Analysis — Claude Opus 4.7 (Non-reasoning)](https://artificialanalysis.ai/models/claude-opus-4-7-non-reasoning)
- [Artificial Analysis — Claude Haiku 4.5](https://artificialanalysis.ai/models/claude-4-5-haiku)
- [Artificial Analysis — GPT-5.5 (xhigh)](https://artificialanalysis.ai/models/gpt-5-5)
- [Artificial Analysis — GPT-5.4 mini (non-reasoning)](https://artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning)
- [Artificial Analysis — Gemini 3.1 Pro Preview](https://artificialanalysis.ai/models/gemini-3-1-pro-preview)
- [Artificial Analysis — Gemini 3 Flash (reasoning)](https://artificialanalysis.ai/models/gemini-3-flash-reasoning)
- [Artificial Analysis — DeepSeek V4 Pro (max)](https://artificialanalysis.ai/models/deepseek-v4-pro)
- [Artificial Analysis — DeepSeek V4 Flash (max)](https://artificialanalysis.ai/models/deepseek-v4-flash)
- [Artificial Analysis — Kimi K2.6](https://artificialanalysis.ai/models/kimi-k2-6)
- [Artificial Analysis — Qwen3.6 Plus](https://artificialanalysis.ai/models/qwen3-6-plus)
- [Artificial Analysis — GLM-5.1 (Reasoning) — verbosity N/A confirmed](https://artificialanalysis.ai/models/glm-5-1)
- [Artificial Analysis — GLM-5.1 (Non-reasoning) — 76M tokens confirmed](https://artificialanalysis.ai/models/glm-5-1-non-reasoning)
- [Artificial Analysis — Llama 3.3 70B](https://artificialanalysis.ai/models/llama-3-3-instruct-70b)
- [Artificial Analysis — MiniMax M2.7](https://artificialanalysis.ai/models/minimax-m2-7)
- [Artificial Analysis — Mistral Large 2](https://artificialanalysis.ai/models/mistral-large-2)
- [Artificial Analysis — Grok 4.1 Fast](https://artificialanalysis.ai/models/grok-4-1-fast)
- [Anthropic — Extended Thinking docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [DeepLearning.AI — GLM-5.1 reasoning behavior (qualitative)](https://www.deeplearning.ai/the-batch/z-ais-glm-5-1-evaluates-interim-results-and-may-change-its-approach-hundreds-of-times-before-it-delivers-final-output)
- [DeepSeek V4 launch — MindStudio](https://www.mindstudio.ai/blog/deepseek-v4-launch-specs-open-weight-2026)
