// Verifies the MECHANICS of the billed-accuracy gate helper on the SYNTHETIC
// fixtures. These synthetic fixtures carry NO real invoice (billedCostPerRun is
// null in expected.json), so this test asserts the gate correctly reports
// hasRealInvoice=false and does NOT pass — proving the drop-in works WITHOUT
// fabricating a bill (P4). The ±5% CLAIM is NOT made by this test.

import { describe, it, expect } from "vitest";
import { runBilledGate, runAllBilledGates } from "./billedGate.helper";

describe("billedGate.helper — gate mechanics on synthetic fixtures", () => {
  it("claude-code-session: no real invoice → gate skipped (hasRealInvoice=false, passesHard=false); deterministic reconstruction still computes 0.03735", () => {
    const g = runBilledGate("claude-code-session.jsonl");
    // Synthetic fixture: NO real invoice yet → the gate MUST NOT pass.
    expect(g.hasRealInvoice).toBe(false);
    expect(g.errorPct).toBeNull();
    expect(g.passesHard).toBe(false);
    expect(g.passesTarget).toBe(false);
    expect(g.billedCost).toBeNull();
    // The deterministic reconstruction still runs — this is the ARITHMETIC proof
    // (separate from billed accuracy) and matches the hand-computed 0.03735.
    expect(g.computedCost).toBeCloseTo(0.03735, 6);
    expect(g.provider).toBe("anthropic");
    expect(g.runs).toBe(2);
    expect(g.sourceModelId).toBe("claude-sonnet-4-6");
  });

  it("droid-run: no real invoice → gate skipped; Anthropic-format trace attributed to glm-5.1", () => {
    const g = runBilledGate("droid-run.json");
    expect(g.hasRealInvoice).toBe(false);
    expect(g.errorPct).toBeNull();
    expect(g.passesHard).toBe(false);
    // droid-run.json is an Anthropic Messages API array (input_tokens usage
    // shape) but model-attributed to glm-5.1: provider is the TRACE FORMAT
    // (anthropic); sourceModelId is the resolved PRICED model (glm-5.1).
    expect(g.sourceModelId).toBe("glm-5.1");
    expect(g.provider).toBe("anthropic");
    expect(g.computedCost).toBeCloseTo(0.01785, 6);
  });

  // ── Load-bearing honesty assertion (P4) ──
  // Without a real invoice the gate MUST report passesHard=false. This is the
  // contract that prevents an unproven ±5% claim: the helper never fabricates a
  // pass. Flip a billed gate to a real it() ONLY after dropping a real trace +
  // the actual per-run billed $ into expected.json (docs/RUNBOOK-billed-accuracy.md).
  it("HONESTY: a null billedCostPerRun never yields passesHard=true (the ±5% gate does not pass without a real invoice)", () => {
    for (const g of runAllBilledGates()) {
      expect(g.hasRealInvoice).toBe(false);
      expect(g.billedCost).toBeNull();
      expect(g.errorPct).toBeNull();
      expect(g.passesHard).toBe(false);
      expect(g.passesTarget).toBe(false);
    }
  });

  it("runAllBilledGates covers every non-underscore fixture in expected.json", () => {
    const all = runAllBilledGates();
    // expected.json today: claude-code-session.jsonl + droid-run.json
    // (the _note / _reconstructed_note keys are filtered out).
    expect(all).toHaveLength(2);
    expect(all.map((g) => g.fixtureName).sort()).toEqual([
      "claude-code-session.jsonl",
      "droid-run.json",
    ]);
  });
});
