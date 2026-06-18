# Capability Matrix — Research Findings

> Researched: 2026-05-30
> Purpose: Story C3 of `BUILD-PLAN-task-classifier.md` — per-domain capability scores + capability floor matrix.
> Scoring domain: **coding** (0-100), **reasoning** (0-100), **general** (0-100).
> Score interpretation: approximate percentile rank against the 2026 production LLM population, calibrated to published benchmark data.
> No invented precision: where benchmark coverage is sparse, a conservative default is used and confidence is marked `low`.

---

## Methodology

### Score derivation

Capability scores on a 0-100 scale are derived from a triangulation of:

1. **Artificial Analysis Intelligence Index v4.0** — composite + per-category sub-scores where published. The index has four equally-weighted categories: Agents, Coding, General, Scientific Reasoning. Each is 25% of the composite. Source: [artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index)

2. **SWE-bench Verified** (2026 leaderboard) — primary coding proxy. Tests real GitHub issues; currently the most cited production-relevant coding benchmark. Source: [benchlm.ai/benchmarks/sweVerified](https://benchlm.ai/benchmarks/sweVerified), [marc0.dev/en/leaderboard](https://www.marc0.dev/en/leaderboard)

3. **GPQA Diamond** — PhD-level scientific reasoning. Used as a reasoning proxy alongside AIME 2026 (math). Source: [lmcouncil.ai/benchmarks](https://lmcouncil.ai/benchmarks)

4. **MMLU / MMLU-Pro / IFEval** — general knowledge + instruction following. Source: [tokencalculator.com/llm-benchmarks](https://tokencalculator.com/llm-benchmarks), [benchlm.ai](https://benchlm.ai)

5. Published vendor technical reports and third-party comparisons (Atlas Cloud, BenchLM, iternal.ai).

### Score calibration

- **90-100**: top-3 globally on primary domain benchmark as of May 2026
- **80-89**: clearly frontier-tier; beats GPT-4-class models solidly
- **70-79**: strong mid-tier; capable of complex tasks with occasional gaps
- **60-69**: competent; handles standard tasks well, struggles with highest-complexity work
- **50-59**: mid-budget tier; adequate for low/med complexity tasks
- **30-49**: budget tier; best suited for simple, well-structured tasks
- **0-29**: not recommended for domain-specific work

### Confidence levels

- `high`: two or more independent benchmarks with consistent signals; strong coverage on AA Index
- `med`: one primary benchmark + AA composite inference; or benchmarks with partial coverage
- `low`: sparse data; conservative default applied; model may actually score higher

---

## Per-Model Capability Scores

### FRONTIER TIER

#### claude-opus-4-7 — Claude Opus 4.7 (Anthropic)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 92 | high | SWE-bench Verified 87.6%; Terminal-Bench 2.0 69.4%; AA Coding category leading (Agents category #1 by landslide on GDPval-AA) |
| reasoning | 90 | high | GPQA Diamond 94.2%; AA composite 57/100 (2nd overall May 2026); AIME 2026 competitive with GPT-5.5 |
| general | 88 | high | AA composite 57; IFBench strong; BrowseComp 79.3%; leads Finance Agent v1.1 (64.4%); MCP Atlas 77.3% |

Sources: [datacamp.com/blog/claude-opus-4-7-vs-gemini-3-1-pro](https://www.datacamp.com/blog/claude-opus-4-7-vs-gemini-3-1-pro); [ofox.ai/blog/gpt-5-5-api-vs-claude-opus-gemini](https://ofox.ai/blog/gpt-5-5-api-vs-claude-opus-gemini-3-1-flagship-2026/); [spectrumailab.com/blog/gemini-3-1-pro-vs-claude-opus-4-7-vs-gpt-5-5](https://spectrumailab.com/blog/gemini-3-1-pro-vs-claude-opus-4-7-vs-gpt-5-5-decision-framework-2026)

---

#### claude-sonnet-4-6 — Claude Sonnet 4.6 (Anthropic)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 85 | high | SWE-bench Verified 79.6% (within 1.2 pts of Opus 4.7); OSWorld computer-use 72.5%; strong on agentic coding tasks |
| reasoning | 74 | high | ARC-AGI-2 58.3% (4.3x jump from Sonnet 4.5, largest single-gen leap); GDPval Office Elo 1633 (beats Opus 4.6); AA non-reasoning variant — solid mid-frontier |
| general | 82 | high | Finance Agent 63.3% (beats Opus 4.6 60.1%); instruction-following strong; consistent mid-frontier positioning across AA general categories |

Sources: [nxcode.io/resources/news/claude-sonnet-4-6-complete-guide](https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026); [anthropic.com/news/claude-sonnet-4-6](https://www.anthropic.com/news/claude-sonnet-4-6); [natural20.com/coverage/claude-sonnet-46-benchmarks](https://natural20.com/coverage/claude-sonnet-46-benchmarks-computer-use-vending-bench)

---

#### gpt-5.5 — GPT-5.5 (OpenAI)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 91 | high | SWE-bench Pro 58.6% (competitive with Opus 4.7); Terminal-Bench 2.0 82.7% (clear #1); AA composite 60/100 (leads May 2026 public snapshot) |
| reasoning | 91 | high | GPQA Diamond ~93-94.4%; ARC-AGI-2 85.0% (#1); BrowseComp 90.1% (#1); AIME 2026 competitive (GPT-5.4 at 99.2% reference point) |
| general | 90 | high | BrowseComp 90.1%; AA composite 60 (highest public model May 2026); broad multi-domain leadership |

Sources: [ofox.ai/blog/gpt-5-5-api-vs-claude-opus-gemini](https://ofox.ai/blog/gpt-5-5-api-vs-claude-opus-gemini-3-1-flagship-2026/); [marc0.dev/en/leaderboard](https://www.marc0.dev/en/leaderboard); [spectrumailab.com/blog/gemini-3-1-pro-vs-claude-opus-4-7-vs-gpt-5-5](https://spectrumailab.com/blog/gemini-3-1-pro-vs-claude-opus-4-7-vs-gpt-5-5-decision-framework-2026)

---

#### gemini-3.1-pro — Gemini 3.1 Pro (Google)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 85 | high | SWE-bench Verified 80.6% (ties DeepSeek V4 Pro); SWE-bench Pro 54.2%; AA composite 57 (tied with Opus 4.7 in April 2026) |
| reasoning | 92 | high | GPQA Diamond 94.3% (#1); ARC-AGI-2 77.1% (strong abstract reasoning); scientific reasoning category leader on AA Index |
| general | 87 | high | AA composite 57; leads classic research-style benchmarks (GPQA, HLE, SciCode); Gemini family multimodal strength; BrowseComp 85.9% |

Sources: [datacamp.com/blog/claude-opus-4-7-vs-gemini-3-1-pro](https://www.datacamp.com/blog/claude-opus-4-7-vs-gemini-3-1-pro); [evolink.ai/blog/gpt-5-4-vs-claude-opus-4-6-vs-gemini-3-1-pro](https://evolink.ai/blog/gpt-5-4-vs-claude-opus-4-6-vs-gemini-3-1-pro-2026); [lmcouncil.ai/benchmarks](https://lmcouncil.ai/benchmarks)

---

#### deepseek-v4-pro — DeepSeek V4 Pro (DeepSeek)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 88 | high | SWE-bench Verified 80.6% (top open-source, ties Gemini 3.1 Pro); LiveCodeBench 93.5%; HumanEval ~96.4%; Codeforces 3206 (top-23 humans) |
| reasoning | 82 | high | MATH-500 ~88.3%; AIME 2025 competitive with GPT-5.5; 1.6T MoE with extended thinking mode |
| general | 78 | med | AA composite indexed; knowledge category #58 weakness noted; strong on coding-adjacent reasoning; broad mid-frontier general capability inferred |

Sources: [codersera.com/blog/deepseek-v4-pro-review-benchmarks-pricing-2026](https://codersera.com/blog/deepseek-v4-pro-review-benchmarks-pricing-2026/); [benchlm.ai/models/deepseek-v4-pro](https://benchlm.ai/models/deepseek-v4-pro); [mindstudio.ai/blog/deepseek-v4-open-source-frontier-model-review](https://www.mindstudio.ai/blog/deepseek-v4-open-source-frontier-model-review)

---

#### kimi-k2.6 — Kimi K2.6 (Moonshot)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 84 | high | SWE-bench Verified 80.2%; SWE-bench Pro 58.6% (+5.2 over Opus 4.6); Terminal-Bench 2.0 66.7%; Kimi Code Bench 68.2%; strong agentic coding |
| reasoning | 80 | high | AIME 2026 96.4% (#1 on that specific benchmark per search data); GPQA Diamond 90.5%; HLE with tools 54.0%; AA composite 54 |
| general | 75 | med | AA composite 54 (behind GPT-5.5 60, Opus 4.7 57); wins on agentic long-horizon tasks; trails on pure math/science vs frontier peers |

Sources: [buildfastwithai.com/blogs/kimi-k2-6-review-benchmarks](https://www.buildfastwithai.com/blogs/kimi-k2-6-review-benchmarks); [llm-stats.com/models/kimi-k2.6](https://llm-stats.com/models/kimi-k2.6); [mindstudio.ai/blog/kimmy-k2-6-qwen-3-6-open-source-frontier-models](https://www.mindstudio.ai/blog/kimmy-k2-6-qwen-3-6-open-source-frontier-models)

---

### MID TIER

#### claude-haiku-4-5 — Claude Haiku 4.5 (Anthropic)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 50 | med | Scored in NON-reasoning mode for consistency with outputMultiplier=0.59 (non-reasoning deployment). Default-mode SWE-bench Verified ~48% → ~50. High-reasoning mode reaches 67% but that is NOT the priced deployment mode — excluded here. |
| reasoning | 58 | med | No direct GPQA/AIME data; inferred from Haiku family position — significantly below Sonnet 4.6 reasoning, suitable for structured reasoning tasks |
| general | 65 | med | Fast Anthropic family; strong instruction-following (Haiku lineage); positioned below Sonnet 4.6 general capability; AA mid-tier placement |

Sources: [benchlm.ai/compare/claude-haiku-4-5-vs-gpt-5-4-mini](https://benchlm.ai/compare/claude-haiku-4-5-vs-gpt-5-4-mini); [failingfast.io/ai-coding-guide/benchmarks](https://failingfast.io/ai-coding-guide/benchmarks/); [learndrive.org/claude-vs-chatgpt-vs-gemini](https://learndrive.org/claude-vs-chatgpt-vs-gemini/)

---

#### gpt-5.4-mini — GPT-5.4 mini (OpenAI)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 66 | low | Non-reasoning default; NO direct SWE-bench data for GPT-5.4 mini (BenchLM flags insufficient overlapping coverage). Score is a conservative estimate from GPT-family mid-tier positioning — NOT benchmark-measured, NOT anchored to any other model. |
| reasoning | 60 | med | Non-reasoning (default); mini tier optimized for throughput; limited benchmark coverage specific to GPT-5.4 mini; conservative estimate from GPT family mid-tier position |
| general | 70 | med | Fast/general positioning; strong instruction-following inherited from GPT-5 family; mid-tier AA composite expected; limited specific published scores |

Sources: [benchlm.ai/compare/claude-haiku-4-5-vs-gpt-5-4-mini](https://benchlm.ai/compare/claude-haiku-4-5-vs-gpt-5-4-mini); [iternal.ai/llm-selection-guide](https://iternal.ai/llm-selection-guide); [aimagicx.com/blog/claude-opus-4-6-vs-gpt-5-4-vs-gemini-3-1-benchmark-comparison-april-2026](https://www.aimagicx.com/blog/claude-opus-4-6-vs-gpt-5-4-vs-gemini-3-1-benchmark-comparison-april-2026)

---

#### gemini-3-flash — Gemini 3 Flash (Google)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 72 | high | SWE-bench Verified 75.8% (strong for mid-tier; close to Grok 4's 75%); reasoning mode default; speed-quality leader in mid tier |
| reasoning | 70 | med | Reasoning-mode default (outputMultiplier 5.1x); Gemini family scientific reasoning strength carries into Flash; no specific GPQA/AIME Flash scores found |
| general | 72 | med | Multimodal + long-context strengths; fast inference; strong at extraction tasks; AA mid-tier composite inferred from Gemini family positioning |

Sources: [failingfast.io/ai-coding-guide/benchmarks](https://failingfast.io/ai-coding-guide/benchmarks/); [learndrive.org/claude-vs-chatgpt-vs-gemini](https://learndrive.org/claude-vs-chatgpt-vs-gemini/); [iternal.ai/llm-selection-guide](https://iternal.ai/llm-selection-guide)

---

#### grok-4.1-fast — Grok 4.1 Fast (xAI)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 58 | med | BenchLM ranks Grok 4.1 Fast #44 in coding category (out of 117 tracked); Grok 4 Code achieved 72-75% SWE-bench but Fast variant is non-reasoning, no extended thinking; 17/221 benchmarks published — limited coverage |
| reasoning | 68 | med | BenchLM ranks Grok 4.1 Fast #8 in reasoning category — strongest dimension; overall score 69/100; non-reasoning model with 2M context; xAI reasoning architecture advantages |
| general | 65 | med | Long-context (2M token) strength; fast inference optimized; mid-tier general capability; positioned for retrieval-heavy and long-doc tasks more than domain depth |

Sources: [benchlm.ai/models/grok-4-1-fast](https://benchlm.ai/models/grok-4-1-fast); [binaryverseai.com/grok-4-1-benchmarks-review](https://binaryverseai.com/grok-4-1-benchmarks-review-eq-creative-writing/); [x.ai/news/grok-4-1](https://x.ai/news/grok-4-1)

---

#### qwen-3.6-plus — Qwen 3.6 Plus (Alibaba)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 78 | high | SWE-bench Verified 78.8%; Terminal-Bench 2.0 61.6% (surpasses Claude 4.5 Opus on this benchmark); LiveBench Coding Average ~71.78 (May 12 snapshot) |
| reasoning | 76 | high | AIME 2026 92.7%; MMLU-Pro 85.2%; chain-of-thought reasoning native; open-weight frontier positioning on math/reasoning |
| general | 73 | med | MMLU-ProX multilingual strong; 1M context native; robust instruction-following; mid-tier AA composite inferred; gaps vs closed frontier on general knowledge depth |

Sources: [buildfastwithai.com/blogs/qwen-3-6-plus-preview-review](https://www.buildfastwithai.com/blogs/qwen-3-6-plus-preview-review); [alibabacloud.com/blog/qwen3-6-plus-towards-real-world-agents](https://www.alibabacloud.com/blog/qwen3-6-plus-towards-real-world-agents_603005); [llm-stats.com/models/qwen3.6-plus](https://llm-stats.com/models/qwen3.6-plus)

---

#### glm-5.1 — GLM 5.1 (Z.ai)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 72 | med | SWE-rebench 62.7%; LiveBench Coding Average 75.37 (May 12 snapshot); Code Arena Elo 1,530 (#3 globally on agentic web dev per Arena.ai); agentic coding average 75 (BenchLM) |
| reasoning | 68 | med | AA Intelligence Index 51 (April 2026); GLM 5.1 Reasoning variant; agentic tasks 65.3 average (vs MiniMax M2.7 57); reasoning model classification in the GLM family |
| general | 65 | low | Limited general benchmark coverage; multiplier confidence on AA is `low` (no reasoning-mode data); overall BenchLM provisional aggregate 82 but methodology differs from AA general score |

Sources: [atlascloud.ai/blog/guides/kimi-k2-6-vs-glm-5-1-vs-qwen-3-6-plus-vs-minimax-m2-7-coding-2026](https://www.atlascloud.ai/blog/guides/kimi-k2-6-vs-glm-5-1-vs-qwen-3-6-plus-vs-minimax-m2-7-coding-2026); [benchlm.ai/compare/glm-5-1-vs-minimax-m2-7](https://benchlm.ai/compare/glm-5-1-vs-minimax-m2-7); [akitaonrails.com/en/2026/04/24/llm-benchmarks-parte-3-deepseek-kimi-mimo](https://akitaonrails.com/en/2026/04/24/llm-benchmarks-parte-3-deepseek-kimi-mimo/)

---

### BUDGET TIER

#### deepseek-v4-flash — DeepSeek V4 Flash (DeepSeek)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 68 | med | SWE-bench Verified approaches V4 Pro (80.6%) only under extended thinking/max-effort; default (non-extended) production deployment rated at ~65-70; score 68 is the upper-conservative estimate for default deployment mode. At max-effort, matches frontier coding but token spend is captured by outputMultiplier=17.1x in models.ts. |
| reasoning | 62 | med | V4-Flash-Max closes gap with V4-Pro substantially on reasoning; default (non-max) production reasoning capability estimated mid-budget; 284B/13B active MoE architecture |
| general | 58 | med | Positioned for high-volume production tasks: chat, summarization, classification, extraction, basic coding; strong throughput story; general capability inferred at budget-tier ceiling |

Sources: [codersera.com/blog/deepseek-v4-pro-vs-flash](https://codersera.com/blog/deepseek-v4-pro-vs-flash/); [artificialanalysis.ai/models/deepseek-v4-flash](https://artificialanalysis.ai/models/deepseek-v4-flash); [blog.kilo.ai/p/we-tested-deepseek-v4-pro-and-flash](https://blog.kilo.ai/p/we-tested-deepseek-v4-pro-and-flash)

---

#### llama-3.3-70b — Llama 3.3 70B (Meta)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 52 | med | HumanEval 88.4% (0-shot, high for 70B); no SWE-bench Verified score found; MMLU-Pro 5-shot CoT 68.9; strong instruction-following (IFEval 92.1%) but no agentic coding evidence |
| reasoning | 48 | med | GPQA Diamond 50.5% (0-shot CoT); significantly below frontier; solid for structured reasoning tasks but not complex multi-step |
| general | 55 | med | MMLU-Pro 68.9; IFEval 92.1% (beats Llama 3.1 405B and GPT-4o); solid general-purpose 70B; widely deployed budget tier; conservative general score given missing broad benchmark coverage |

Sources: [datacamp.com/blog/llama-3-3-70b](https://www.datacamp.com/blog/llama-3-3-70b); [github.com/meta-llama/llama3/blob/main/eval_details.md](https://github.com/meta-llama/llama3/blob/main/eval_details.md); [tokencalculator.com/llm-benchmarks](https://tokencalculator.com/llm-benchmarks)

---

#### minimax-m2.7 — MiniMax M2.7 (MiniMax)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 58 | med | SWE-Pro 56.22%; Terminal Bench 2: 57.0%; PinchBench 86.2% (5th overall, within 1.2 pts of Claude Opus 4.6); Kilo Bench 47% pass rate (2nd overall) |
| reasoning | 55 | med | AA Intelligence Index 50 (8th globally); 8-point jump from predecessor in 1 month; self-evolving reinforcement learning architecture; not a dedicated reasoning model (unlike GLM 5.1) |
| general | 56 | med | VIBE-Pro 55.6%; positioned as cost-effective self-evolving model; can handle 30-50% of RL research workflow autonomously; general capability mid-budget |

Sources: [benchlm.ai/compare/glm-5-1-vs-minimax-m2-7](https://benchlm.ai/compare/glm-5-1-vs-minimax-m2-7); [minimax.io/news/minimax-m27-en](https://www.minimax.io/news/minimax-m27-en); [tokenmix.ai/blog/minimax-m2-7-review-benchmark-2026](https://tokenmix.ai/blog/minimax-m2-7-review-benchmark-2026)

---

#### mistral-large-2 — Mistral Large 2 (Mistral)

| Domain | Score | Confidence | Primary Evidence |
|--------|-------|------------|-----------------|
| coding | 60 | med | HumanEval 92.0% (matches Claude 3.5 Sonnet on this benchmark); multilingual coding average 76.9% (vs GPT-4o 77.9%); no SWE-bench or agentic coding score found — HumanEval-only coverage is a known limitation |
| reasoning | 52 | med | MATH 71.5% (surpasses Gemini 1.5 Pro, GPT-4 era models); GSM8K 93%; MMLU 84.0%; no GPQA Diamond or AIME coverage — capped at conservative estimate for a 2024-era "Large" model against 2026 competition |
| general | 60 | med | MMLU 84.0%; multilingual MMLU strong (French 82.8%, German 81.6%); good instruction-following; solid but not updated since 2024 — now budget-tier vs 2026 mid-tier models |

Sources: [platform-docs-public.pages.dev/getting-started/models/benchmark](https://platform-docs-public.pages.dev/getting-started/models/benchmark/); [techzine.eu/news/analytics/mistral-unveils-large-2-model](https://www.techzine.eu/news/analytics/122742/mistral-unveils-large-2-model-large-enough-but-good-enough/); [maginative.com/article/mistral-ai-unveils-mistral-large-2](https://www.maginative.com/article/mistral-ai-unveils-mistral-large-2)

---

## Summary Table

| Model ID | Tier | coding | reasoning | general | coding_conf | reasoning_conf | general_conf |
|----------|------|--------|-----------|---------|-------------|----------------|--------------|
| claude-opus-4-7 | frontier | 92 | 90 | 88 | high | high | high |
| claude-sonnet-4-6 | frontier | 85 | 74 | 82 | high | high | high |
| gpt-5.5 | frontier | 91 | 91 | 90 | high | high | high |
| gemini-3.1-pro | frontier | 85 | 92 | 87 | high | high | high |
| deepseek-v4-pro | frontier | 88 | 82 | 78 | high | high | med |
| kimi-k2.6 | frontier | 84 | 80 | 75 | high | high | med |
| claude-haiku-4-5 | mid | 50 | 58 | 65 | med | med | med |
| gpt-5.4-mini | mid | 66 | 60 | 70 | low | med | med |
| gemini-3-flash | mid | 72 | 70 | 72 | high | med | med |
| grok-4.1-fast | mid | 58 | 68 | 65 | med | med | med |
| qwen-3.6-plus | mid | 78 | 76 | 73 | high | high | med |
| glm-5.1 | mid | 72 | 68 | 65 | med | med | low |
| deepseek-v4-flash | budget | 68 | 62 | 58 | med | med | med |
| llama-3.3-70b | budget | 52 | 48 | 55 | med | med | med |
| minimax-m2.7 | budget | 58 | 55 | 56 | med | med | med |
| mistral-large-2 | budget | 60 | 52 | 60 | med | med | med |

---

## Capability Floor Matrix

> Purpose: `CAPABILITY_FLOOR[taskType][complexity]` → minimum required domain score.
> A model must clear ALL specified floors (coding + reasoning + general) to be recommended for a given (taskType, complexity) cell.
> Rationale: grounded in what each task type actually bottlenecks on, not a single domain.

### Floor Design Rationale

**Task types → dominant domain bottleneck:**
- `coding`: bottlenecks on `coding` score (SWE-bench, HumanEval proxy); reasoning matters for complex multi-file refactors; general matters for reading docs/comments
- `extraction`: bottlenecks on `general` (instruction-following, schema compliance); minimal reasoning; minimal coding
- `research`: bottlenecks on `general` + `reasoning` (synthesis, factuality, multi-hop); coding not relevant
- `agentic`: bottlenecks on ALL three — tool-use loops require coding (tool call generation), reasoning (loop management), general (task decomposition)
- `reasoning`: bottlenecks on `reasoning` (GPQA/AIME proxy); general matters for framing; coding not required
- `chat`: bottlenecks on `general` (fluency, instruction-following, helpfulness); reasoning and coding low unless specialized

**Complexity → floor multiplier logic:**
- `low`: well-specified, single-step or 2-3 step tasks. Budget-tier models can handle these.
- `med`: multi-step, moderate context, typical production workloads. Mid-tier competence required.
- `high`: open-ended, ambiguous, long-horizon, or multi-file/multi-source. Frontier capabilities required for reliable output.

---

### coding

| Complexity | coding_floor | reasoning_floor | general_floor | Rationale |
|------------|-------------|-----------------|---------------|-----------|
| low | 50 | 40 | 45 | Single-function generation, bug fixes with clear stack trace. 50+ coding passes HumanEval-style tasks. Budget tier sufficient. |
| med | 68 | 55 | 55 | Multi-file edits, test writing, API integration. Requires reliable code generation across files + basic reasoning about control flow. DeepSeek V4 Flash (coding=68) is the minimum viable mid-tier exemplar — exactly meets the floor. Gemini 3 Flash (coding=72) and Grok 4.1 Fast (coding=58, fails) bound the range. Haiku 4.5 (coding=50) falls below this floor and does not qualify. |
| high | 82 | 72 | 70 | Repository-level refactoring, agentic SWE-bench-style tasks, multi-turn debugging. Must clear 82 coding (DeepSeek V4 Pro / Gemini 3.1 Pro territory) + strong reasoning for loop-back error correction. |

---

### extraction

| Complexity | coding_floor | reasoning_floor | general_floor | Rationale |
|------------|-------------|-----------------|---------------|-----------|
| low | 0 | 35 | 50 | Structured field extraction, simple JSON parsing. Any model with decent instruction-following suffices. |
| med | 0 | 45 | 62 | Schema-constrained extraction with type coercion, nested structures, partial match. Requires solid instruction-following (IFEval-class). |
| high | 0 | 55 | 72 | Multi-document extraction with ambiguity resolution, context-sensitive field mapping. General score 72+ (Gemini 3 Flash tier) needed for reliable high-accuracy output. |

---

### research

| Complexity | coding_floor | reasoning_floor | general_floor | Rationale |
|------------|-------------|-----------------|---------------|-----------|
| low | 0 | 45 | 55 | Single-source summarization, FAQ answering. Low reasoning bar — factual recall + fluency. |
| med | 0 | 60 | 68 | Multi-source synthesis, citation, comparison tasks. Passing exemplars (reasoning≥60, general≥68): Gemini 3 Flash (r70/g72), GPT-5.4 mini (r60/g70), Qwen 3.6 Plus. Grok 4.1 Fast does NOT clear — general=65 < 68. |
| high | 0 | 78 | 82 | Cross-domain research synthesis, adversarial claim verification, long-context multi-doc analysis. Only frontier clears reasoning≥78 AND general≥82: Claude Opus 4.7, GPT-5.5, Gemini 3.1 Pro. Kimi K2.6 (general=75) and DeepSeek V4 Pro (general=78) fall short of the general floor. |

---

### agentic

| Complexity | coding_floor | reasoning_floor | general_floor | Rationale |
|------------|-------------|-----------------|---------------|-----------|
| low | 55 | 52 | 58 | Simple tool-use loop: 1-3 tool calls, well-defined success criterion. Budget tier can handle if tools are simple. |
| med | 68 | 65 | 68 | Multi-tool chains (5-15 calls), conditional branching, error recovery. Gemini 3 Flash (coding=72, reasoning=70, general=72) is the minimum-passing exemplar. Haiku 4.5 (reasoning=58, general=65) fails both reasoning and general floors — not a valid exemplar for this cell. |
| high | 82 | 80 | 78 | Long-horizon agentic tasks (GDPval-AA class, Claude Code style), 20+ tool calls, ambiguous termination. Only frontier clears all three floors: Claude Opus 4.7, GPT-5.5, Gemini 3.1 Pro, DeepSeek V4 Pro (general=78, exactly clears). Kimi K2.6 does NOT qualify — general=75 < 78. |

---

### reasoning

| Complexity | coding_floor | reasoning_floor | general_floor | Rationale |
|------------|-------------|-----------------|---------------|-----------|
| low | 0 | 48 | 50 | Deduction from provided premises, basic logic puzzles. Llama 3.3 70B (reasoning 48) at the minimum viable floor. |
| med | 0 | 65 | 60 | Multi-step logical inference, structured argumentation, basic math (GSM8K class). Grok 4.1 Fast / Gemini Flash tier. |
| high | 0 | 80 | 72 | PhD-level reasoning, GPQA Diamond class, competition math, strategic planning. Must clear 80 reasoning — Kimi K2.6+ required. |

---

### chat

| Complexity | coding_floor | reasoning_floor | general_floor | Rationale |
|------------|-------------|-----------------|---------------|-----------|
| low | 0 | 35 | 50 | FAQ bots, simple Q&A, templated responses. Any budget model. |
| med | 0 | 45 | 62 | Customer support, open-domain conversation, content generation. Minimum-passing exemplars (general≥62): Claude Haiku 4.5 (65), Grok 4.1 Fast (65), GLM 5.1 (65). Llama 3.3 70B (general=55) and MiniMax M2.7 (general=56) fall short. |
| high | 0 | 58 | 75 | Domain-expert chat, nuanced tone-matching, long personalized conversations. The general≥75 floor excludes Gemini 3 Flash (72), Qwen 3.6 Plus (73), and GPT-5.4 mini (70). Minimum-passing exemplar is Kimi K2.6 (general=75, just clears); Claude Sonnet 4.6, DeepSeek V4 Pro, and frontier clear comfortably. |

---

## Floor Matrix — Compact Form

For implementation in `src/lib/recommend.ts`:

```ts
// CAPABILITY_FLOOR[taskType][complexity] = { coding, reasoning, general }
export const CAPABILITY_FLOOR = {
  coding: {
    low:  { coding: 50, reasoning: 40, general: 45 },
    med:  { coding: 68, reasoning: 55, general: 55 },
    high: { coding: 82, reasoning: 72, general: 70 },
  },
  extraction: {
    low:  { coding:  0, reasoning: 35, general: 50 },
    med:  { coding:  0, reasoning: 45, general: 62 },
    high: { coding:  0, reasoning: 55, general: 72 },
  },
  research: {
    low:  { coding:  0, reasoning: 45, general: 55 },
    med:  { coding:  0, reasoning: 60, general: 68 },
    high: { coding:  0, reasoning: 78, general: 82 },
  },
  agentic: {
    low:  { coding: 55, reasoning: 52, general: 58 },
    med:  { coding: 68, reasoning: 65, general: 68 },
    high: { coding: 82, reasoning: 80, general: 78 },
  },
  reasoning: {
    low:  { coding:  0, reasoning: 48, general: 50 },
    med:  { coding:  0, reasoning: 65, general: 60 },
    high: { coding:  0, reasoning: 80, general: 72 },
  },
  chat: {
    low:  { coding:  0, reasoning: 35, general: 50 },
    med:  { coding:  0, reasoning: 45, general: 62 },
    high: { coding:  0, reasoning: 58, general: 75 },
  },
} as const;
```

---

## Key Caveats

1. **GLM-5.1 general score is low-confidence**: No reasoning-mode general/knowledge benchmark data on Artificial Analysis. Score 65 is a conservative estimate; actual may be higher. Do not rely on this for high-stakes routing.

2. **GPT-5.4 mini coverage gap**: BenchLM explicitly flagged "not enough overlapping benchmark coverage for a complete fair comparison." Scores are inference from GPT family positioning and limited published data.

3. **Grok 4.1 Fast coding weakness**: Only 17/221 benchmarks published on BenchLM (May 2026). Ranked #44 in coding out of 117 models — notably weak for a mid-tier model. The 2M context window makes it strong for long-doc retrieval tasks despite low coding score.

4. **DeepSeek V4 Flash coding score (68) = default deployment only**: SWE-bench Verified near-parity with V4 Pro (80.6%) is achieved only under max-effort extended thinking — that mode's token cost is already captured by `outputMultiplier=17.1x` in `models.ts`. The capability score (68) reflects the non-extended default deployment mode (estimated ~65-70 per vendor comparisons; 68 is the upper-conservative point). Do not interpret the score as max-effort capability.

5. **Mistral Large 2 vintage**: Benchmarks are from the 2024 release. No 2026 updated evaluation found. Scored against 2026 competition, not 2024 peers — this explains why it sits at budget tier despite strong 2024 numbers (HumanEval 92%, MMLU 84%).

6. **SWE-bench Verified contamination note**: OpenAI stopped reporting Verified scores (recommending SWE-bench Pro instead) citing data contamination concerns. Verified scores used here are from third-party re-evals. Applied a conservative ±3 point adjustment in floor calibration to account for possible inflation.

7. **Floor cells with `coding: 0`**: This means coding capability is not a gating factor for the task type — any model passing the reasoning + general floors qualifies. The recommendation engine should treat 0 as "no constraint" not as "requires 0% coding ability."

---

## Sources (primary)

- [Artificial Analysis Intelligence Index](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index)
- [Artificial Analysis Coding Index](https://artificialanalysis.ai/models/capabilities/coding)
- [BenchLM — Artificial Analysis Intelligence Index 2026 (126 models)](https://benchlm.ai/benchmarks/artificialAnalysis)
- [SWE-bench Verified Leaderboard — marc0.dev May 2026](https://www.marc0.dev/en/leaderboard)
- [SWE-bench Verified — benchlm.ai](https://benchlm.ai/benchmarks/sweVerified)
- [LM Council AI Model Benchmarks May 2026](https://lmcouncil.ai/benchmarks)
- [DataCamp — Claude Opus 4.7 vs Gemini 3.1 Pro](https://www.datacamp.com/blog/claude-opus-4-7-vs-gemini-3-1-pro)
- [NxCode — Claude Sonnet 4.6 Complete Guide](https://www.nxcode.io/resources/news/claude-sonnet-4-6-complete-guide-benchmarks-pricing-2026)
- [Anthropic — Introducing Claude Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6)
- [BenchLM — Claude Haiku 4.5 vs GPT-5.4 mini comparison](https://benchlm.ai/compare/claude-haiku-4-5-vs-gpt-5-4-mini)
- [BenchLM — GLM-5.1 vs MiniMax M2.7 comparison](https://benchlm.ai/compare/glm-5-1-vs-minimax-m2-7)
- [BenchLM — Grok 4.1 Fast](https://benchlm.ai/models/grok-4-1-fast)
- [BenchLM — DeepSeek V4 Pro](https://benchlm.ai/models/deepseek-v4-pro)
- [BenchLM — Qwen3.6 Plus](https://benchlm.ai/models/qwen3-6-plus)
- [CodersEra — DeepSeek V4 Pro Review](https://codersera.com/blog/deepseek-v4-pro-review-benchmarks-pricing-2026/)
- [CodersEra — DeepSeek V4 Pro vs Flash](https://codersera.com/blog/deepseek-v4-pro-vs-flash/)
- [Kilo.ai — Kimi K2.6 Review](https://blog.kilo.ai/p/kimi-k26-has-arrived-an-open-weight)
- [buildfastwithai — Kimi K2.6 Review](https://www.buildfastwithai.com/blogs/kimi-k2-6-review-benchmarks)
- [Alibaba Cloud — Qwen3.6 Plus Towards Real World Agents](https://www.alibabacloud.com/blog/qwen3-6-plus-towards-real-world-agents_603005)
- [AtlasCloud — Chinese model coding comparison 2026](https://www.atlascloud.ai/blog/guides/kimi-k2-6-vs-glm-5-1-vs-qwen-3-6-plus-vs-minimax-m2-7-coding-2026)
- [MiniMax — M2.7 announcement](https://www.minimax.io/news/minimax-m27-en)
- [DataCamp — Llama 3.3 70B](https://www.datacamp.com/blog/llama-3-3-70b)
- [Mistral AI — Mistral Large 2 benchmarks](https://platform-docs-public.pages.dev/getting-started/models/benchmark/)
- [iternal.ai — LLM Benchmarks 2026 (30+ models)](https://iternal.ai/llm-selection-guide)
- [smartchunks.com — AA Intelligence Index April 2026 Explained](https://smartchunks.com/artificial-analysis-intelligence-index-april-2026-explained/)
