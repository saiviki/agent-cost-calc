"use client";

import { useState, useMemo, useCallback } from "react";
import { MODELS, formatCost, type Model } from "@/lib/models";
import {
  type Trace,
  type Span,
  type VerbosityEntry,
  type CounterfactualResult,
  DEFAULT_VERBOSITY_MAP,
  EXAMPLE_TRACE,
  computeCounterfactual,
  buildVerbosityMap,
  parseTrace,
  costSpan,
} from "@/lib/counterfactual";

// ── Helper: format delta percentage ───────────────────────────────────
function formatDelta(delta: number): string {
  const pct = Math.round(Math.abs(delta) * 100);
  if (delta === 0) return "baseline";
  return delta > 0 ? `−${pct}%` : `+${pct}%`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

// ── Tab link component ────────────────────────────────────────────────
function TabLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? "bg-stone-800 text-white"
          : "text-stone-500 hover:text-stone-700 hover:bg-stone-100"
      }`}
    >
      {label}
    </a>
  );
}

// ── Span Breakdown Component ──────────────────────────────────────────
function SpanBreakdown({
  result,
  originalModelId,
}: {
  result: CounterfactualResult;
  originalModelId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-stone-100 pt-3 mt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-stone-400 hover:text-stone-700 transition-colors flex items-center gap-1"
      >
        <span
          className={`inline-block transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        >
          ▸
        </span>
        Span-by-span breakdown
      </button>
      {expanded && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-stone-400 border-b border-stone-100">
                <th className="py-1.5 pr-3 font-medium">Call ID</th>
                <th className="py-1.5 pr-3 font-medium">Tool</th>
                <th className="py-1.5 pr-3 font-medium text-right">
                  {originalModelId === result.model_id
                    ? "Original Cost"
                    : `Original (${originalModelId})`}
                </th>
                <th className="py-1.5 pr-3 font-medium text-right">
                  Counterfactual Cost
                </th>
                <th className="py-1.5 font-medium text-right">Delta</th>
              </tr>
            </thead>
            <tbody>
              {result.per_span_costs.map((sc) => {
                const spanDelta =
                  sc.original_cost > 0
                    ? 1 - sc.counterfactual_cost / sc.original_cost
                    : 0;
                return (
                  <tr
                    key={sc.call_id}
                    className="border-b border-stone-50 text-stone-600"
                  >
                    <td className="py-1.5 pr-3 font-mono">{sc.call_id}</td>
                    <td className="py-1.5 pr-3">
                      {sc.tool_name ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {formatCost(sc.original_cost)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">
                      {formatCost(sc.counterfactual_cost)}
                    </td>
                    <td className="py-1.5 text-right font-mono text-stone-500">
                      {formatDelta(spanDelta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Invoice Validation Component ──────────────────────────────────────
function InvoiceValidation({
  computedCost,
}: {
  computedCost: number;
}) {
  const [actualInvoice, setActualInvoice] = useState("");
  const amount = parseFloat(actualInvoice);

  const errorPct =
    amount > 0
      ? (Math.abs(computedCost - amount) / amount) * 100
      : null;

  const color =
    errorPct === null
      ? ""
      : errorPct < 5
      ? "text-green-600"
      : errorPct < 15
      ? "text-amber-600"
      : "text-red-600";

  const bgColor =
    errorPct === null
      ? ""
      : errorPct < 5
      ? "bg-green-50 border-green-200"
      : errorPct < 15
      ? "bg-amber-50 border-amber-200"
      : "bg-red-50 border-red-200";

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
        Invoice Validation
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500">
            Computed cost (original, V=1.0)
          </label>
          <div className="text-base font-mono font-semibold text-stone-900">
            {formatCost(computedCost)}
          </div>
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="invoice-amount"
            className="text-xs font-medium text-stone-500"
          >
            Actual invoice amount ($)
          </label>
          <input
            id="invoice-amount"
            type="number"
            step="0.001"
            min="0"
            placeholder="0.000"
            value={actualInvoice}
            onChange={(e) => setActualInvoice(e.target.value)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-stone-400"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500">
            Error
          </label>
          <div className={`text-base font-mono font-semibold ${color}`}>
            {errorPct !== null ? `${errorPct.toFixed(2)}%` : "—"}
          </div>
        </div>
      </div>
      {errorPct !== null && errorPct >= 15 && (
        <div
          className={`text-xs p-3 rounded-lg border space-y-2 ${bgColor}`}
        >
          <p className={`font-semibold ${color}`}>
            Error ≥ 15% — possible discrepancy sources:
          </p>
          <ul className="list-disc list-inside space-y-1 text-stone-600">
            <li>
              <strong>Cache-write costs not captured</strong> — Add{" "}
              <code className="bg-stone-100 px-1 rounded">
                cached_tokens_written × P_cache_write
              </code>{" "}
              per span
            </li>
            <li>
              <strong>Batch API discount</strong> — Apply 0.5× multiplier for
              async/batch endpoint
            </li>
            <li>
              <strong>Token-count drift</strong> — Diff a few spans against raw
              response headers
            </li>
            <li>
              <strong>Rounding</strong> — Model as{" "}
              <code className="bg-stone-100 px-1 rounded">
                ceil(cost × 10⁶) / 10⁶
              </code>{" "}
              per span
            </li>
            <li>
              <strong>Minimum charge floor</strong> — Check pricing page fine
              print
            </li>
          </ul>
        </div>
      )}
      {errorPct !== null && errorPct >= 5 && errorPct < 15 && (
        <div className={`text-xs p-3 rounded-lg border ${bgColor}`}>
          <p className={`font-medium ${color}`}>
            5–15% error — check cache-write costs, batch discounts, or token
            drift.
          </p>
        </div>
      )}
      {errorPct !== null && errorPct < 5 && (
        <div className={`text-xs p-3 rounded-lg border ${bgColor}`}>
          <p className={`font-medium ${color}`}>
            ✓ Within 5% tolerance — computed cost matches invoice.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Trace Analyzer Page ──────────────────────────────────────────
export default function TraceAnalyzerPage() {
  const [rawInput, setRawInput] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [verbosityEntries, setVerbosityEntries] = useState<VerbosityEntry[]>(
    DEFAULT_VERBOSITY_MAP
  );
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const handleLoadExample = useCallback(() => {
    const json = JSON.stringify(EXAMPLE_TRACE, null, 2);
    setRawInput(json);
    try {
      const parsed = parseTrace(json);
      setTrace(parsed);
      setParseError(null);
    } catch {
      /* won't happen */
    }
  }, []);

  const handleAnalyze = useCallback(() => {
    try {
      const parsed = parseTrace(rawInput);
      setTrace(parsed);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Parse error");
      setTrace(null);
    }
  }, [rawInput]);

  const results = useMemo(() => {
    if (!trace) return [];
    const vMap = buildVerbosityMap(verbosityEntries);
    return computeCounterfactual(trace, MODELS, vMap).sort(
      (a, b) => a.total_cost - b.total_cost
    );
  }, [trace, verbosityEntries]);

  const originalModelId = trace?.spans[0]?.model_id ?? "";
  const originalResult = results.find((r) => r.model_id === originalModelId);
  const computedOriginalCost = originalResult?.total_cost ?? 0;

  const handleVerbosityChange = useCallback(
    (modelId: string, value: string) => {
      const num = parseFloat(value);
      if (isNaN(num)) return;
      setVerbosityEntries((prev) =>
        prev.map((e) => (e.model_id === modelId ? { ...e, v: num } : e))
      );
    },
    []
  );

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-12">
      <div className="max-w-5xl mx-auto space-y-10">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
              Agent Cost Calculator
            </h1>
          </div>
          {/* Tab switcher */}
          <div className="flex items-center gap-2 pt-2">
            <TabLink href="/" label="Cost Estimator" active={false} />
            <TabLink
              href="/trace"
              label="Trace Analyzer"
              active={true}
            />
          </div>
        </div>

        {/* Description */}
        <p className="text-stone-500 text-sm leading-relaxed max-w-2xl">
          Paste a trace from a real agent run (JSON or CSV) to see what it would
          have cost on every model. Input tokens are held fixed; output tokens
          are scaled by a per-model verbosity multiplier.
        </p>

        {/* Input area */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Trace Input
            </h2>
            <button
              type="button"
              onClick={handleLoadExample}
              className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
            >
              Load example trace
            </button>
          </div>
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder={`Paste JSON trace:\n{\n  "trace_id": "my-run-001",\n  "spans": [...]\n}\n\nOr CSV:\ncall_id,model_id,tool_name,input_tokens,output_tokens,cached_tokens\ns1,claude-opus-4-7,retriever,4200,890,1800`}
            rows={12}
            className="w-full px-4 py-3 border border-stone-200 rounded-xl text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 focus:border-stone-400 resize-y text-stone-800 placeholder:text-stone-300"
          />
          {parseError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {parseError}
            </p>
          )}
          <button
            type="button"
            onClick={handleAnalyze}
            className="px-5 py-2.5 bg-stone-800 text-white text-sm font-medium rounded-lg hover:bg-stone-700 transition-colors"
          >
            Analyze
          </button>
        </div>

        {/* Results */}
        {trace && results.length > 0 && (
          <>
            {/* Trace summary */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-500">
              <span>
                Trace:{" "}
                <span className="font-mono font-medium text-stone-700">
                  {trace.trace_id}
                </span>
              </span>
              <span>
                Spans:{" "}
                <span className="font-mono font-medium text-stone-700">
                  {trace.spans.length}
                </span>
              </span>
              <span>
                Original model:{" "}
                <span className="font-mono font-medium text-stone-700">
                  {originalModelId}
                </span>
              </span>
            </div>

            {/* Main results table */}
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-left text-stone-500">
                      <th className="px-4 py-3 font-semibold">Model</th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Cost
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        vs Original
                      </th>
                      <th className="px-4 py-3 font-semibold text-right">
                        Output (scaled)
                      </th>
                      <th className="px-4 py-3 font-semibold">
                        Top cost driver
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const isOriginal = r.model_id === originalModelId;
                      return (
                        <tr
                          key={r.model_id}
                          className={`border-b border-stone-100 cursor-pointer transition-colors ${
                            isOriginal
                              ? "bg-blue-50/60"
                              : "hover:bg-stone-50"
                          }`}
                          onClick={() =>
                            setExpandedModel(
                              expandedModel === r.model_id
                                ? null
                                : r.model_id
                            )
                          }
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-medium ${
                                  isOriginal
                                    ? "text-blue-800"
                                    : "text-stone-800"
                                }`}
                              >
                                {r.model_name}
                              </span>
                              {isOriginal && (
                                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                                  original
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-stone-800">
                            {formatCost(r.total_cost)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-medium ${
                              isOriginal
                                ? "text-blue-600"
                                : r.delta_vs_original > 0
                                ? "text-green-700"
                                : r.delta_vs_original < 0
                                ? "text-red-600"
                                : "text-stone-500"
                            }`}
                          >
                            {formatDelta(r.delta_vs_original)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-stone-600">
                            {formatTokens(r.scaled_output_tokens)} tok
                            {r.verbosity_multiplier !== 1.0 && (
                              <span className="ml-1 text-xs text-amber-600 font-semibold">
                                ×{r.verbosity_multiplier.toFixed(2)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-stone-500 text-xs">
                            {r.top_cost_driver}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Expanded span breakdown */}
            {expandedModel && (
              <div className="bg-white border border-stone-200 rounded-xl p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
                  Span Breakdown —{" "}
                  {results.find((r) => r.model_id === expandedModel)?.model_name}
                </h3>
                {(() => {
                  const result = results.find(
                    (r) => r.model_id === expandedModel
                  );
                  if (!result) return null;
                  return (
                    <SpanBreakdown
                      result={result}
                      originalModelId={originalModelId}
                    />
                  );
                })()}
              </div>
            )}

            {/* Invoice Validation */}
            <InvoiceValidation computedCost={computedOriginalCost} />

            {/* Verbosity Multipliers */}
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
              <details>
                <summary className="text-xs font-semibold uppercase tracking-wider text-stone-400 cursor-pointer hover:text-stone-700 transition-colors">
                  Verbosity Multipliers
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-stone-400 border-b border-stone-100">
                        <th className="py-1.5 pr-4 font-medium">Model</th>
                        <th className="py-1.5 font-medium">V (multiplier)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verbosityEntries.map((entry) => (
                        <tr
                          key={entry.model_id}
                          className="border-b border-stone-50"
                        >
                          <td className="py-1.5 pr-4 text-stone-700">
                            {MODELS.find((m) => m.id === entry.model_id)?.name ??
                              entry.model_id}
                          </td>
                          <td className="py-1.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              max="3"
                              value={entry.v}
                              onChange={(e) =>
                                handleVerbosityChange(
                                  entry.model_id,
                                  e.target.value
                                )
                              }
                              className="w-20 px-2 py-1 border border-stone-200 rounded text-sm font-mono text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-stone-300 pt-4">
          Built by{" "}
          <a
            href="https://github.com/saiviki"
            className="underline underline-offset-2 hover:text-stone-500"
          >
            Sai Viki
          </a>{" "}
          · Pricing via OpenRouter + provider docs · Lineup curated from
          real-usage rankings
        </div>
      </div>
    </main>
  );
}
