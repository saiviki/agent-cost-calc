// C6 — classifyTask unit tests. Cases transcribed verbatim from
// SPEC-task-classifier.md §10 (7 fixtures), including the all-zero-signals edge
// case (Case 7) and the undefined-signals guard (§6).
// All fixtures are inline ParsedRun objects; no file I/O.
import { describe, it, expect } from "vitest";
import { classifyTask } from "../classifyTask";
import type { ParsedRun } from "../parseTrace";

describe("classifyTask — task-type + complexity classification (SPEC §10)", () => {
  // Case 1 — Coding trace (file-edit heavy, Claude Code .jsonl)
  it("classifies a file-edit-heavy trace as coding/med", () => {
    const p: ParsedRun = {
      sourceModel: "claude-sonnet-4-6",
      runs: 3,
      avgInputTokens: 2000,
      avgOutputTokens: 800,
      avgCacheReadTokens: 1500,
      avgCacheCreationTokens: 200,
      measuredCacheHitRate: 0.53,
      toolCallsPerRun: 3.33,
      warnings: [],
      signals: {
        toolNames: { str_replace_editor: 6, bash: 4, read_file: 3 },
        totalToolCalls: 13,
        turnCount: 3,
        outputToInputRatio: 800 / (2000 + 1500 + 200), // ≈ 0.22
        hasCodeBlocks: true,
        hasJsonOutput: false,
        hasCitations: false,
        reasoningTokenRatio: 0.0,
        repairSignals: 1,
      },
    };

    const cls = classifyTask(p);

    // coding score: file_edit min(6*4, 20)=20 + bash min(4*2, 10)=8 + hasCodeBlocks=3
    //              + file_read min(3*0.5, 3)=1.5 = 32.5
    // outputToInputRatio 0.22 < 1.5 → +0; repairSignals 1 < 2 → +0
    // agentic score: totalToolCalls min(13*0.8, 24)=10.4
    //               + turnCount=3, does NOT clear ≥5 threshold → +0
    //               + repairSignals=1 → 1×1.5=1.5
    //               + mixed groups: file_edit+bash+file_read = 3 groups → +2.0
    //               = 13.9
    // coding wins (32.5 vs 13.9) by wide margin; confidence high
    expect(cls.taskType).toBe("coding");
    expect(cls.taskTypeConfidence).toBeGreaterThan(0.5);

    // complexity: tool_pts=2 (13 calls → high=2) + turn_pts=1 (3 turns → med=1)
    //             + reasoning_pts=0 + repair_pts=1 (1 repair → low-mid=1) = 4 → med
    expect(cls.complexity).toBe("med");

    expect(cls.evidence.some((e) => e.includes("file-edit"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("bash"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("code blocks"))).toBe(true);
  });

  // Case 2 — Extraction trace (JSON output, tool-free)
  it("classifies a JSON-output, tool-free trace as extraction/low", () => {
    const p: ParsedRun = {
      sourceModel: "claude-haiku-4-5",
      runs: 1,
      avgInputTokens: 3000,
      avgOutputTokens: 400,
      avgCacheReadTokens: 0,
      avgCacheCreationTokens: 0,
      measuredCacheHitRate: 0,
      toolCallsPerRun: 0,
      warnings: [],
      signals: {
        toolNames: {},
        totalToolCalls: 0,
        turnCount: 1,
        outputToInputRatio: 400 / 3000, // 0.133
        hasCodeBlocks: false,
        hasJsonOutput: true,
        hasCitations: false,
        reasoningTokenRatio: 0.0,
        repairSignals: 0,
      },
    };

    const cls = classifyTask(p);

    // extraction score: hasJsonOutput=4.0 + outputToInputRatio 0.133≤0.3=2.5
    //                  + toolCallsPerRun=0 → +1.5 = 8.0
    // chat score: toolCallsPerRun=0 → +3.0; ratio [0.2,1.2]: 0.133 < 0.2 → NO = 3.0
    // extraction wins (8.0 vs 3.0)
    expect(cls.taskType).toBe("extraction");
    expect(cls.taskTypeConfidence).toBeGreaterThan(0.4);

    // complexity: 0+0+0+0 = 0 → low
    expect(cls.complexity).toBe("low");

    expect(cls.evidence.some((e) => e.includes("JSON"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("tool-free"))).toBe(true);
  });

  // Case 3 — Research trace (search + fetch + citations)
  it("classifies a web-search + citation trace as research/med", () => {
    const p: ParsedRun = {
      sourceModel: "claude-sonnet-4-6",
      runs: 2,
      avgInputTokens: 1500,
      avgOutputTokens: 1800,
      avgCacheReadTokens: 800,
      avgCacheCreationTokens: 300,
      measuredCacheHitRate: 0.31,
      toolCallsPerRun: 2.5,
      warnings: [],
      signals: {
        toolNames: { web_search: 3, web_fetch: 2 },
        totalToolCalls: 5,
        turnCount: 2,
        outputToInputRatio: 1800 / (1500 + 800 + 300), // ≈ 0.69
        hasCodeBlocks: false,
        hasJsonOutput: false,
        hasCitations: true,
        reasoningTokenRatio: 0.15,
        repairSignals: 0,
      },
    };

    const cls = classifyTask(p);

    // research score: search min(3*4, 16)=12 + fetch min(2*2.5, 7.5)=5
    //                + hasCitations=3.0 + ratio 0.69 ≥ 1.0? NO → 0
    //                + reasoningTokenRatio 0.15 ≥ 0.3? NO → 0 = 20.0
    // agentic score: totalToolCalls min(5*0.8, 24)=4.0; 2 groups < 3 → no bonus = 4.0
    // research wins (20.0 vs 4.0); very high confidence
    expect(cls.taskType).toBe("research");
    expect(cls.taskTypeConfidence).toBeGreaterThan(0.8);

    // complexity: tool_pts=1 (5 calls → med=1) + turn_pts=0 + reasoning_pts=1 (0.15 ≥ 0.1)
    //             + repair_pts=0 = 2 → low
    expect(cls.complexity).toBe("low");

    expect(cls.evidence.some((e) => e.includes("web-search"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("URL-fetch"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("URLs or footnote"))).toBe(true);
  });

  // Case 4 — Agentic loop trace (computer-use + repairs + long session)
  it("classifies a computer-use, high-repair, multi-turn trace as agentic/high", () => {
    const p: ParsedRun = {
      sourceModel: "claude-opus-4-7",
      runs: 8,
      avgInputTokens: 4000,
      avgOutputTokens: 600,
      avgCacheReadTokens: 3000,
      avgCacheCreationTokens: 500,
      measuredCacheHitRate: 0.4,
      toolCallsPerRun: 1.5,
      warnings: [],
      signals: {
        toolNames: {
          computer: 3,
          bash: 5,
          read_file: 4,
        },
        totalToolCalls: 12,
        turnCount: 8,
        outputToInputRatio: 600 / (4000 + 3000 + 500), // ≈ 0.08
        hasCodeBlocks: false,
        hasJsonOutput: false,
        hasCitations: false,
        reasoningTokenRatio: 0.35,
        repairSignals: 3,
      },
    };

    const cls = classifyTask(p);

    // agentic score: totalToolCalls min(12*0.8, 24)=9.6 + computer min(3*3, 9)=9.0
    //               + repairSignals min(3*1.5, 6)=4.5 + turnCount ≥ 5 → +2.0
    //               + turnCount ≥ 10? NO → 0
    //               + tool groups: computer+bash+file_read = 3 groups → +2.0 = 27.1
    // coding score: bash min(5*2, 10)=10 + file_read min(4*0.5, 3)=2.0
    //              + repairSignals=3 ≥ 2 → +1.0 = 13.0
    // agentic wins (27.1 vs 13.0)
    expect(cls.taskType).toBe("agentic");
    expect(cls.taskTypeConfidence).toBeGreaterThan(0.7);

    // complexity: tool_pts=2 (12→high) + turn_pts=2 (8→high) + reasoning_pts=1 (0.35 in [0.1,0.4])
    //             + repair_pts=2 (3 repairs → high) = 7 → high
    expect(cls.complexity).toBe("high");

    expect(cls.evidence.some((e) => e.includes("computer-use"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("repair"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("turn"))).toBe(true);
  });

  // Case 5 — Reasoning trace (extended thinking, no tools)
  // NOTE: SPEC §10 titles this "reasoning/med" but the fixture's own complexity
  // arithmetic (reasoning_pts=2 only → total 2 → low band) yields "low", and the
  // SPEC comment block itself concludes "→ low". Title is a SPEC typo; we assert low.
  it("classifies a high-reasoning-ratio, tool-free trace as reasoning/low", () => {
    const p: ParsedRun = {
      sourceModel: "claude-opus-4-7",
      runs: 1,
      avgInputTokens: 500,
      avgOutputTokens: 800,
      avgCacheReadTokens: 0,
      avgCacheCreationTokens: 0,
      measuredCacheHitRate: 0,
      toolCallsPerRun: 0,
      warnings: [],
      signals: {
        toolNames: {},
        totalToolCalls: 0,
        turnCount: 1,
        outputToInputRatio: 800 / 500, // 1.6
        hasCodeBlocks: false,
        hasJsonOutput: false,
        hasCitations: false,
        reasoningTokenRatio: 0.65, // thinking tokens = 65% of output tokens
        repairSignals: 0,
      },
    };

    const cls = classifyTask(p);

    // reasoning score: ratio 0.65 ≥ 0.5 → +5.0 + toolCallsPerRun=0 → +2.0
    //                 + ratio 1.6 > 1.5, band [0.3,1.5] does NOT fire → 0 = 7.0
    // Runner-up is RESEARCH, not chat: research gets ratio 1.6 ≥ 1.0 → +1.5 AND
    //   reasoningTokenRatio 0.65 ≥ 0.3 → +1.0 = 2.5. (chat = 3.0 toolFree − 1.5
    //   reasoning-penalty = 1.5; coding/extraction = 1.5 each.) The SPEC §10 Case 5
    //   comment's "reasoning wins 7.0 vs 1.5" only compared against chat and missed
    //   that research outscores it — same class of comment-arithmetic errata as the
    //   documented B3/B4 fixes in SPEC-recommend.md §8. The reasoning WINNER is
    //   unambiguous (7.0 vs 2.5); only the margin differs from the comment.
    //   True margin = 7.0 − 2.5 = 4.5 → confidence = 4.5/10 = 0.45.
    expect(cls.taskType).toBe("reasoning");
    expect(cls.taskTypeConfidence).toBeCloseTo(0.45, 2);

    // complexity: tool_pts=0 + turn_pts=0 + reasoning_pts=2 (0.65 > 0.4 → high=2)
    //             + repair_pts=0 = 2 → low
    expect(cls.complexity).toBe("low");

    expect(cls.evidence.some((e) => e.includes("reasoning token ratio"))).toBe(true);
    expect(cls.evidence.some((e) => e.includes("tool-free"))).toBe(true);
  });

  // Case 6 — Chat trace (conversational, no tools, no special signals)
  it("classifies a tool-free, moderate-output, no-special-signal trace as chat/low", () => {
    const p: ParsedRun = {
      sourceModel: "claude-haiku-4-5",
      runs: 1,
      avgInputTokens: 300,
      avgOutputTokens: 250,
      avgCacheReadTokens: 0,
      avgCacheCreationTokens: 0,
      measuredCacheHitRate: 0,
      toolCallsPerRun: 0,
      warnings: [],
      signals: {
        toolNames: {},
        totalToolCalls: 0,
        turnCount: 1,
        outputToInputRatio: 250 / 300, // 0.833
        hasCodeBlocks: false,
        hasJsonOutput: false,
        hasCitations: false,
        reasoningTokenRatio: 0.0,
        repairSignals: 0,
      },
    };

    const cls = classifyTask(p);

    // chat score: toolCallsPerRun=0 → +3.0 + ratio [0.2,1.2]: 0.833 → +2.0 = 5.0
    // reasoning score: ratio 0.0 < 0.2 → 0; toolCallsPerRun=0 → +2.0;
    //                  ratio 0.833 in [0.3,1.5] → +1.5 = 3.5
    // chat wins (5.0 vs reasoning 3.5)
    expect(cls.taskType).toBe("chat");
    expect(cls.complexity).toBe("low");

    // confidence: margin = 1.5, normalized = 1.5/10 = 0.15
    expect(cls.taskTypeConfidence).toBeGreaterThan(0.0);
    expect(cls.evidence.some((e) => e.includes("tool-free"))).toBe(true);
  });

  // Case 7 — All-zero signals edge case (bare-minimum trace)
  it("returns chat/low with zero confidence when all signals are zero", () => {
    const p: ParsedRun = {
      sourceModel: undefined,
      runs: 1,
      avgInputTokens: 100,
      avgOutputTokens: 100,
      avgCacheReadTokens: 0,
      avgCacheCreationTokens: 0,
      measuredCacheHitRate: 0,
      toolCallsPerRun: 0,
      warnings: [],
      signals: {
        toolNames: {},
        totalToolCalls: 0,
        turnCount: 1,
        outputToInputRatio: 1.0,
        hasCodeBlocks: false,
        hasJsonOutput: false,
        hasCitations: false,
        reasoningTokenRatio: 0.0,
        repairSignals: 0,
      },
    };

    const cls = classifyTask(p);

    // chat: toolCallsPerRun=0 → +3.0; ratio [0.2,1.2]: 1.0 → +2.0 = 5.0
    // reasoning: toolCallsPerRun=0 → +2.0; ratio [0.3,1.5]: 1.0 → +1.5 = 3.5
    // chat wins; margin 1.5 → confidence = 1.5/10 = 0.15
    expect(cls.taskType).toBe("chat");
    expect(cls.complexity).toBe("low");
    expect(cls.taskTypeConfidence).toBeCloseTo(0.15, 2);
    expect(cls.complexityConfidence).toBe(0.0); // score=0, at band floor → 0
  });

  // §6 guard — undefined signals must short-circuit to chat/low, never throw.
  it("returns chat/low with zero confidence and does not throw when signals is undefined", () => {
    const p: ParsedRun = {
      sourceModel: undefined,
      runs: 1,
      avgInputTokens: 100,
      avgOutputTokens: 100,
      avgCacheReadTokens: 0,
      avgCacheCreationTokens: 0,
      measuredCacheHitRate: 0,
      toolCallsPerRun: 0,
      warnings: [],
      // signals deliberately omitted (type-legal: signals?)
    };

    expect(() => classifyTask(p)).not.toThrow();
    const cls = classifyTask(p);
    expect(cls.taskType).toBe("chat");
    expect(cls.complexity).toBe("low");
    expect(cls.taskTypeConfidence).toBe(0.0);
    expect(cls.complexityConfidence).toBe(0.0);
    expect(cls.evidence).toEqual([]);
  });
});
