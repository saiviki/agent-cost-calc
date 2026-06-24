import { describe, it, expect } from "vitest";
import {
  costSpan,
  computeCounterfactual,
  buildVerbosityMap,
  parseTrace,
  parseTraceJSON,
  parseTraceCSV,
  type Trace,
} from "./counterfactual";
import { MODELS, type Model } from "./models";

// Helper: find a model by id
function findModel(id: string): Model {
  const m = MODELS.find((m) => m.id === id);
  if (!m) throw new Error(`Model ${id} not found`);
  return m;
}

describe("costSpan", () => {
  it("single span, no caching, V=1.0 → exact arithmetic check", () => {
    const model = findModel("claude-opus-4-7");
    const span = {
      call_id: "s1",
      model_id: "claude-opus-4-7",
      tool_name: "retriever",
      input_tokens: 10_000,
      output_tokens: 5_000,
      cached_tokens: 0,
    };
    const v = 1.0;

    // cost = [input * P_in + 0 * P_cr + (output * V) * P_out] / 1e6
    //      = [10000 * 5.0 + 0 + 5000 * 25.0] / 1e6
    //      = [50000 + 125000] / 1e6
    //      = 175000 / 1e6
    //      = 0.175
    const expected = (10_000 * 5.0 + 5_000 * 25.0) / 1_000_000;
    const result = costSpan(span, model, v);

    expect(result).toBeCloseTo(expected, 10);
    expect(result).toBeCloseTo(0.175, 10);
  });

  it("single span with cache hit, V=1.2 → verify cache read pricing applied", () => {
    const model = findModel("claude-opus-4-7");
    const span = {
      call_id: "s2",
      model_id: "claude-opus-4-7",
      tool_name: "code_executor",
      input_tokens: 10_000,
      output_tokens: 5_000,
      cached_tokens: 6_000, // 6000 of the 10000 input tokens are cached
    };
    const v = 1.2;

    // uncached = 10000 - 6000 = 4000
    // cache_read price = 0.50
    // cost = [4000 * 5.0 + 6000 * 0.50 + (5000 * 1.2) * 25.0] / 1e6
    //      = [20000 + 3000 + 150000] / 1e6
    //      = 173000 / 1e6
    //      = 0.173
    const uncached = 10_000 - 6_000;
    const expected =
      (uncached * 5.0 + 6_000 * 0.5 + 5_000 * 1.2 * 25.0) / 1_000_000;
    const result = costSpan(span, model, v);

    expect(result).toBeCloseTo(expected, 10);
    expect(result).toBeCloseTo(0.173, 10);
  });

  it("model without cache read price falls back to input price", () => {
    // llama-3.3-70b has no cacheReadPricePerM (supportsCache: false)
    const model = findModel("llama-3.3-70b");
    const span = {
      call_id: "s3",
      model_id: "llama-3.3-70b",
      input_tokens: 10_000,
      output_tokens: 2_000,
      cached_tokens: 3_000,
    };
    const v = 1.0;

    // cacheReadPricePerM is undefined → falls back to inputPricePerM = 0.10
    // cost = [(10000-3000)*0.10 + 3000*0.10 + 2000*0.32] / 1e6
    //      = [700 + 300 + 640] / 1e6
    //      = 1640 / 1e6
    //      = 0.00164
    const expected =
      ((10_000 - 3_000) * 0.1 + 3_000 * 0.1 + 2_000 * 0.32) / 1_000_000;
    const result = costSpan(span, model, v);

    expect(result).toBeCloseTo(expected, 10);
  });
});

describe("computeCounterfactual", () => {
  it("multi-span trace → total cost = sum of spans", () => {
    const trace: Trace = {
      trace_id: "test-multi-span",
      spans: [
        {
          call_id: "s1",
          model_id: "claude-opus-4-7",
          tool_name: "retriever",
          input_tokens: 4_000,
          output_tokens: 800,
          cached_tokens: 1_500,
        },
        {
          call_id: "s2",
          model_id: "claude-opus-4-7",
          tool_name: "code_executor",
          input_tokens: 6_000,
          output_tokens: 2_000,
          cached_tokens: 2_500,
        },
        {
          call_id: "s3",
          model_id: "claude-opus-4-7",
          tool_name: "reviewer",
          input_tokens: 5_000,
          output_tokens: 1_500,
          cached_tokens: 2_000,
        },
      ],
    };

    // All V=1.0 for this test
    const vMap = buildVerbosityMap(
      MODELS.map((m) => ({ model_id: m.id, v: 1.0 }))
    );

    const results = computeCounterfactual(trace, MODELS, vMap);

    // Verify result count matches model count
    expect(results.length).toBe(MODELS.length);

    // For each model, verify total_cost = sum of per_span costs
    for (const result of results) {
      const sumOfSpans = result.per_span_costs.reduce(
        (sum, sc) => sum + sc.counterfactual_cost,
        0
      );
      expect(result.total_cost).toBeCloseTo(sumOfSpans, 10);
    }

    // Verify the original model result (claude-opus-4-7) with V=1.0
    const originalResult = results.find((r) => r.model_id === "claude-opus-4-7");
    expect(originalResult).toBeDefined();
    expect(originalResult!.delta_vs_original).toBeCloseTo(0, 10);

    // Manually compute the expected cost for claude-opus-4-7 (V=1.0)
    const model = findModel("claude-opus-4-7");
    const expectedCost =
      costSpan(trace.spans[0], model, 1.0) +
      costSpan(trace.spans[1], model, 1.0) +
      costSpan(trace.spans[2], model, 1.0);
    expect(originalResult!.total_cost).toBeCloseTo(expectedCost, 10);
  });

  it("results are sorted by total_cost ascending (cheapest first) when sorted externally", () => {
    const trace: Trace = {
      trace_id: "test-sort",
      spans: [
        {
          call_id: "s1",
          model_id: "claude-opus-4-7",
          input_tokens: 5_000,
          output_tokens: 1_000,
          cached_tokens: 1_000,
        },
      ],
    };

    const vMap = buildVerbosityMap(
      MODELS.map((m) => ({ model_id: m.id, v: 1.0 }))
    );
    const results = computeCounterfactual(trace, MODELS, vMap).sort(
      (a, b) => a.total_cost - b.total_cost
    );

    for (let i = 1; i < results.length; i++) {
      expect(results[i].total_cost).toBeGreaterThanOrEqual(
        results[i - 1].total_cost
      );
    }
  });

  it("delta_vs_original is positive for cheaper models, negative for more expensive", () => {
    const trace: Trace = {
      trace_id: "test-delta",
      spans: [
        {
          call_id: "s1",
          model_id: "deepseek-v4-flash", // very cheap model
          input_tokens: 5_000,
          output_tokens: 1_000,
          cached_tokens: 0,
        },
      ],
    };

    const vMap = buildVerbosityMap(
      MODELS.map((m) => ({ model_id: m.id, v: 1.0 }))
    );
    const results = computeCounterfactual(trace, MODELS, vMap);

    // Original model should have delta = 0
    const original = results.find((r) => r.model_id === "deepseek-v4-flash");
    expect(original!.delta_vs_original).toBeCloseTo(0, 10);

    // More expensive models should have negative delta
    const expensive = results.find((r) => r.model_id === "claude-opus-4-7");
    expect(expensive!.delta_vs_original).toBeLessThan(0);
  });

  it("applies verbosity multiplier to output tokens only", () => {
    const trace: Trace = {
      trace_id: "test-verbosity",
      spans: [
        {
          call_id: "s1",
          model_id: "claude-opus-4-7",
          input_tokens: 10_000,
          output_tokens: 5_000,
          cached_tokens: 0,
        },
      ],
    };

    const model = findModel("claude-opus-4-7");

    // Compare V=1.0 vs V=1.5
    const vMap1 = buildVerbosityMap([
      { model_id: "claude-opus-4-7", v: 1.0 },
    ]);
    const vMap15 = buildVerbosityMap([
      { model_id: "claude-opus-4-7", v: 1.5 },
    ]);

    const resultV1 = computeCounterfactual(trace, [model], vMap1);
    const resultV15 = computeCounterfactual(trace, [model], vMap15);

    // With V=1.5, output cost increases by 50%
    const inputCost = (10_000 * 5.0) / 1_000_000;
    const outputCostV1 = (5_000 * 1.0 * 25.0) / 1_000_000;
    const outputCostV15 = (5_000 * 1.5 * 25.0) / 1_000_000;

    expect(resultV1[0].total_cost).toBeCloseTo(inputCost + outputCostV1, 10);
    expect(resultV15[0].total_cost).toBeCloseTo(inputCost + outputCostV15, 10);

    // scaled_output_tokens should reflect the multiplier
    expect(resultV1[0].scaled_output_tokens).toBe(5_000);
    expect(resultV15[0].scaled_output_tokens).toBe(7_500);
  });
});

describe("parseTrace", () => {
  it("parses valid JSON trace", () => {
    const json = JSON.stringify({
      trace_id: "test-json",
      spans: [
        {
          call_id: "s1",
          model_id: "claude-opus-4-7",
          tool_name: "retriever",
          input_tokens: 100,
          output_tokens: 50,
          cached_tokens: 20,
        },
      ],
    });
    const trace = parseTrace(json);
    expect(trace.trace_id).toBe("test-json");
    expect(trace.spans.length).toBe(1);
    expect(trace.spans[0].call_id).toBe("s1");
    expect(trace.spans[0].input_tokens).toBe(100);
  });

  it("parses valid CSV trace", () => {
    const csv = `call_id,model_id,tool_name,input_tokens,output_tokens,cached_tokens
s1,claude-opus-4-7,retriever,100,50,20
s2,claude-opus-4-7,code_executor,200,100,50`;
    const trace = parseTrace(csv);
    expect(trace.spans.length).toBe(2);
    expect(trace.spans[0].call_id).toBe("s1");
    expect(trace.spans[1].tool_name).toBe("code_executor");
    expect(trace.spans[1].input_tokens).toBe(200);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTraceJSON("{not json")).toThrow();
  });

  it("throws on JSON missing required fields", () => {
    expect(() =>
      parseTraceJSON(JSON.stringify({ trace_id: "x" }))
    ).toThrow("Trace must have a 'trace_id' and 'spans' array");
  });

  it("throws on CSV with missing columns", () => {
    expect(() => parseTraceCSV("call_id,model_id\ns1,claude-opus-4-7")).toThrow(
      "CSV missing required column"
    );
  });
});
