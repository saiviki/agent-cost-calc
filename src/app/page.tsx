"use client";

import { useState, useMemo, useEffect } from "react";
import {
  MODELS,
  TIER_LABEL,
  STRENGTH_LABEL,
  filterModels,
  calculateCost,
  formatCost,
  PRICING_FETCHED_AT,
  type AgentConfig,
  type Tier,
  type Strength,
  type Model,
  type CostBreakdown,
} from "@/lib/models";
import {
  parseTrace,
  parsedRunToConfig,
  TraceParseError,
  type ParsedRun,
} from "@/lib/parseTrace";
import {
  projectCounterfactual,
  cacheRateInsight,
} from "@/lib/counterfactual";
import { reconstructCost } from "@/lib/reconstructCost";
import { projectRetokenized, type RetokenizedCostRow } from "@/lib/retokenizedCost";
import {
  classifyTask,
  type Classification,
  type TaskType,
  type Complexity,
} from "@/lib/classifyTask";
import { recommend, type Recommendation } from "@/lib/recommend";

const DEFAULT_CONFIG: AgentConfig = {
  modelId: "claude-sonnet-4-6", // most-used model on OpenRouter
  systemPromptTokens: 2000,
  inputTokensPerRun: 1500,
  outputTokensPerRun: 500,
  toolCallsPerRun: 3,
  tokensPerToolCall: 300,
  cacheHitRate: 0.7,
  runsPerDay: 100,
};

const TIERS: Tier[] = ["frontier", "mid", "budget"];
const STRENGTHS: Strength[] = [
  "coding",
  "reasoning",
  "multimodal",
  "long-context",
  "fast",
  "general",
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline">
        <label className="text-sm font-medium text-stone-700">{label}</label>
        <span className="text-sm font-mono font-semibold text-stone-900">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-stone-200 accent-stone-800 cursor-pointer"
      />
      {hint && <p className="text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

function Chip<T extends string>({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "bg-stone-800 text-white border-stone-800"
          : "bg-white text-stone-500 border-stone-200 hover:border-stone-400 hover:text-stone-700"
      }`}
      type="button"
    >
      {label}
    </button>
  );
}

function CostBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-stone-500">
        <span>{label}</span>
        <span className="font-mono">
          {formatCost(value)} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Tier accent colors. Static class strings so Tailwind JIT keeps them.
const TIER_DOT: Record<Tier, string> = {
  frontier: "bg-indigo-500",
  mid: "bg-emerald-500",
  budget: "bg-amber-500",
};
const TIER_BAR: Record<Tier, string> = {
  frontier: "bg-indigo-500",
  mid: "bg-emerald-500",
  budget: "bg-amber-500",
};
const TIER_SELECTED_ROW: Record<Tier, string> = {
  frontier: "bg-indigo-50",
  mid: "bg-emerald-50",
  budget: "bg-amber-50",
};

type ModelRow = { model: Model; cost: CostBreakdown };

function ModelTable({
  rows,
  maxCost,
  selectedId,
  onSelect,
}: {
  rows: ModelRow[];
  maxCost: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-stone-400 italic py-4 text-center border border-dashed border-stone-200 rounded-lg">
        No models match these filters.
      </div>
    );
  }
  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-3 py-2.5">
              Model
            </th>
            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-3 py-2.5 hidden sm:table-cell">
              Strengths
            </th>
            <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-3 py-2.5 hidden md:table-cell">
              Price /M
            </th>
            <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-3 py-2.5 hidden md:table-cell">
              Ctx
            </th>
            <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-3 py-2.5 w-[30%] min-w-[140px]">
              Cost / run
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ model, cost }) => {
            const selected = model.id === selectedId;
            const pct = maxCost > 0 ? (cost.totalPerRun / maxCost) * 100 : 0;
            return (
              <tr
                key={model.id}
                onClick={() => onSelect(model.id)}
                className={`cursor-pointer border-b border-stone-100 last:border-0 transition-colors ${
                  selected
                    ? TIER_SELECTED_ROW[model.tier]
                    : "hover:bg-stone-50"
                }`}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-[3px] h-8 rounded-full ${TIER_BAR[model.tier]} ${
                        selected ? "opacity-100" : "opacity-40"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-medium truncate ${
                            selected ? "text-stone-900" : "text-stone-800"
                          }`}
                        >
                          {model.name}
                        </span>
                        {model.isOpen && (
                          <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-50 text-emerald-700">
                            open
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-stone-400 flex items-center gap-1.5">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${TIER_DOT[model.tier]}`}
                        />
                        {TIER_LABEL[model.tier]} · {model.provider}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {model.strengths.slice(0, 3).map((s) => (
                      <span
                        key={s}
                        className="text-[10px] px-1.5 py-0.5 rounded-full border border-stone-200 text-stone-500 capitalize"
                      >
                        {STRENGTH_LABEL[s]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-stone-500 hidden md:table-cell">
                  ${model.inputPricePerM}·${model.outputPricePerM}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-stone-500 hidden md:table-cell">
                  {model.contextK}K
                </td>
                <td className="px-3 py-2.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xs whitespace-nowrap ml-auto ${
                        selected ? "font-semibold text-stone-900" : "text-stone-600"
                      }`}
                    >
                      {formatCost(cost.totalPerRun)}
                    </span>
                  </div>
                  <div className="h-1 bg-stone-100 rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full rounded-full ${TIER_BAR[model.tier]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function toggleSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// C5 — confidence indicator bar for the Task DNA card. Clamps to [0,1];
// never NaN-renders (missing-signal traces yield 0-confidence verdicts).
function ConfidenceBar({ value, label }: { value: number; label: string }) {
  const pct =
    Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className="space-y-1">
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-stone-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-stone-400">{label}</span>
    </div>
  );
}

// ── S4 — "Paste a real run" panel ──────────────────────────────────────────
// Collapsible profiler that lives above the sliders. Parses a real agent trace,
// fills the config sliders, surfaces the measured cache-rate reveal, and renders
// a cross-model effective-vs-nominal counterfactual table. Never crashes the page.
function TracePanel({
  config,
  onProfiled,
}: {
  config: AgentConfig;
  onProfiled: (cfg: AgentConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  // Set only after a successful profile — drives the reveal + counterfactual.
  const [parsed, setParsed] = useState<ParsedRun | null>(null);
  const [profiledConfig, setProfiledConfig] = useState<AgentConfig | null>(null);
  const [costMode, setCostMode] = useState<"effective" | "nominal" | "retokenized">("effective");
  // C5 — Task DNA override. null = use the auto-detected classifier verdict.
  const [typeOverride, setTypeOverride] = useState<TaskType | null>(null);
  const [complexityOverride, setComplexityOverride] =
    useState<Complexity | null>(null);

  function handleProfile() {
    try {
      const result = parseTrace(raw);
      // parsedRunToConfig mutates result.warnings — call before reading warnings.
      const cfg = parsedRunToConfig(result);
      setParsed(result);
      setProfiledConfig(cfg);
      setWarnings(result.warnings);
      setError(null);
      // Fresh trace → drop any stale manual override so the new auto-verdict shows.
      setTypeOverride(null);
      setComplexityOverride(null);
      onProfiled(cfg);
    } catch (e) {
      // Defensive: typed parse errors get their message; anything else is wrapped.
      if (e instanceof TraceParseError) {
        setError(e.message);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Could not parse this trace.");
      }
      setWarnings([]);
      setParsed(null);
      setProfiledConfig(null);
    }
  }

  // Counterfactual is driven by the profiled config (anchor = trace source model).
  // Recomputes when the live config changes too, so slider tweaks re-project.
  const projection = useMemo(() => {
    if (!profiledConfig) return null;
    return projectCounterfactual({ ...profiledConfig, ...sliderOverrides(config) });
  }, [profiledConfig, config]);

  const insight = useMemo(() => {
    if (!profiledConfig) return null;
    return cacheRateInsight({ ...profiledConfig, ...sliderOverrides(config) });
  }, [profiledConfig, config]);

  // For nominal mode, recompute each row without the verbosity multiplier so the
  // Δ% and ordering reflect raw list-price cost. Effective mode uses the engine rows.
  const rows = useMemo(() => {
    if (!projection) return null;
    if (costMode === "effective") return projection;
    const merged = { ...profiledConfig!, ...sliderOverrides(config) };
    const anchorId = merged.modelId;
    const nominal = projection.map((p) => {
      const breakdown = calculateCost(merged, p.model, { applyMultiplier: false });
      return {
        ...p,
        breakdown,
        effectiveOutputTokens: merged.outputTokensPerRun,
        deltaVsAnchorPct: null as number | null,
      };
    });
    const anchorMonthly = nominal.find((r) => r.model.id === anchorId)?.breakdown
      .totalPerMonth;
    if (anchorMonthly !== undefined && anchorMonthly !== 0) {
      for (const r of nominal) {
        if (r.isAnchor) r.deltaVsAnchorPct = null;
        else
          r.deltaVsAnchorPct =
            Math.round(
              ((r.breakdown.totalPerMonth - anchorMonthly) / anchorMonthly) *
                1000,
            ) / 10;
      }
    }
    nominal.sort((a, b) => a.breakdown.totalPerMonth - b.breakdown.totalPerMonth);
    return nominal;
  }, [projection, costMode, profiledConfig, config]);

  // C5 — Task DNA: classify the parsed run's behavioral signature. Pure +
  // no-throw by contract, but wrap defensively so a bad trace never crashes.
  const classification = useMemo<Classification | null>(() => {
    if (!parsed) return null;
    try {
      return classifyTask(parsed);
    } catch {
      return null;
    }
  }, [parsed]);

  // Effective profile = manual override falling back to the auto verdict.
  const effectiveType: TaskType | null =
    typeOverride ?? classification?.taskType ?? null;
  const effectiveComplexity: Complexity | null =
    complexityOverride ?? classification?.complexity ?? null;

  // C5 — capability-floor recommendation. Re-runs when the override changes.
  // Uses the profiled config merged with live slider tweaks (same basis the
  // counterfactual table uses), so the saving matches what the table shows.
  const recommendation = useMemo<Recommendation | null>(() => {
    if (!parsed || !profiledConfig || !classification) return null;
    if (!effectiveType || !effectiveComplexity) return null;
    const merged = { ...profiledConfig, ...sliderOverrides(config) };
    const cls: Classification = {
      ...classification,
      taskType: effectiveType,
      complexity: effectiveComplexity,
    };
    try {
      return recommend(parsed, cls, merged);
    } catch {
      return null;
    }
  }, [
    parsed,
    profiledConfig,
    classification,
    effectiveType,
    effectiveComplexity,
    config,
  ]);

  const typeOverridden = typeOverride !== null;
  const complexityOverridden = complexityOverride !== null;

  const anchorModel = profiledConfig
    ? MODELS.find((m) => m.id === profiledConfig.modelId)
    : undefined;
  // Tooltip cites the multiplier provenance for the anchor's effective-cost math.
  const multiplierTooltip = anchorModel
    ? `Effective cost normalizes output tokens by each model's verbosity multiplier (baseline Claude Sonnet 4.6 = 1.0). Anchor ${anchorModel.name}: ${anchorModel.outputMultiplier}× · source: ${anchorModel.multiplierSource ?? "n/a"} · confidence: ${anchorModel.multiplierConfidence ?? "low"}.`
    : "Effective cost normalizes output tokens by each model's verbosity multiplier.";

  // Phase 2 — explains the retokenized counterfactual (distinct number kind from
  // the effective-cost multiplierTooltip above: re-tokenizes the SAME captured
  // text, no cache/batch, exact OpenAI / approx Claude-Gemini).
  const retokenizedTooltip =
    "Retokenized = re-tokenizes the CAPTURED output text under each model's tokenizer and prices it at list rates (no cache/batch). Exact for OpenAI (gpt-tokenizer), approx for Claude/Gemini (no official client-side tokenizer). Models the tokenizer effect on the SAME text — NOT model verbosity (Phase 3 replay).";

  // Phase 1 ground-truth reconstruction: cost of the captured run on its ORIGINAL
  // model, derived from provider raw_usage as billed (exact cache/batch rates,
  // no verbosity estimate). Distinct from the heuristic projection below.
  // Swallow ReconstructError (unknown usage shape / missing usage) so the page
  // never crashes — same defensive posture as `error`/`warnings` above.
  // Placed after anchorModel (declared just above) so it is in scope.
  const reconstruction = useMemo(() => {
    if (!parsed?.rawCalls?.length || !anchorModel) return null;
    try {
      return reconstructCost({ rawCalls: parsed.rawCalls, model: anchorModel });
    } catch {
      return null;
    }
  }, [parsed, anchorModel]);

  // Phase 2 cost layer (docs/RESEARCH-validation-methodology.md §4.3, §3.2).
  // Cost of the captured run re-tokenized under each model's tokenizer, priced
  // at list rates (NO cache, NO batch — counterfactual default). Exact for
  // OpenAI (gpt-tokenizer), approx for Claude/Gemini. Never reads
  // model.outputMultiplier. Defensive try/catch so a bad trace never crashes.
  const retokenizedRows = useMemo<RetokenizedCostRow[] | null>(() => {
    if (!parsed?.rawCalls?.length) return null;
    try {
      return projectRetokenized(parsed.rawCalls);
    } catch {
      return null;
    }
  }, [parsed]);

  return (
    <section className="border border-stone-200 rounded-xl bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-stone-800">
            Paste a real run
          </span>
          <span className="text-[10px] uppercase tracking-wider text-stone-400 border border-stone-200 rounded px-1.5 py-0.5">
            profiler
          </span>
        </div>
        <span className="text-stone-400 text-sm">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-stone-100">
          <p className="text-xs text-stone-500 leading-relaxed pt-4">
            Paste an Anthropic Messages API response (JSON) or a Claude Code
            session <code className="font-mono text-stone-600">.jsonl</code>. We
            read the real token usage — including your measured cache hit rate —
            then project effective cost across every model.
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{ "model": "claude-sonnet-4-6", "usage": { "input_tokens": 1500, "output_tokens": 500, "cache_read_input_tokens": 8000, "cache_creation_input_tokens": 2000 } }'
            spellCheck={false}
            className="w-full h-32 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-mono text-stone-700 placeholder:text-stone-300 focus:outline-none focus:border-stone-400 resize-y"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleProfile}
              disabled={raw.trim() === ""}
              className="text-sm px-4 py-2 rounded-lg bg-stone-800 text-white font-medium hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400 transition-colors"
            >
              Profile this run
            </button>
            {parsed && (
              <span className="text-xs text-stone-400">
                {parsed.runs} run{parsed.runs === 1 ? "" : "s"} parsed
                {parsed.sourceModel ? ` · ${parsed.sourceModel}` : ""}
              </span>
            )}
          </div>

          {/* Inline error — never crashes the page */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 space-y-1">
              <p className="text-xs font-medium text-red-700">
                Couldn&apos;t parse this run
              </p>
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Warnings (non-fatal) */}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-1">
              <p className="text-xs font-medium text-amber-700">
                Parsed with {warnings.length} note
                {warnings.length === 1 ? "" : "s"}
              </p>
              <ul className="text-xs text-amber-600 list-disc list-inside space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Cache-rate reveal — the hero moment */}
          {insight && (
            <div className="rounded-lg border border-stone-800 bg-stone-800 text-white px-4 py-3.5 space-y-1">
              <p className="text-xs uppercase tracking-wider text-stone-400 font-semibold">
                Cache-rate reveal
              </p>
              <p className="text-sm">
                Your measured cache hit rate:{" "}
                <span className="font-mono font-semibold text-base">
                  {Math.round(insight.measured * 100)}%
                </span>
                .
                {insight.monthlySavingAtNinety > 0 ? (
                  <>
                    {" "}
                    At 90% you&apos;d save{" "}
                    <span className="font-mono font-semibold text-amber-300">
                      {formatCost(insight.monthlySavingAtNinety)}/mo
                    </span>
                    .
                  </>
                ) : (
                  <span className="text-stone-300">
                    {" "}
                    Already at or above 90% — caching is well-tuned.
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Reconstructed actual cost — ground truth from provider raw_usage */}
          {reconstruction && reconstruction.totalComputed > 0 && (
            <div className="rounded-lg border border-stone-300 bg-stone-50 px-4 py-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-stone-800">
                  Reconstructed actual cost
                </span>
                <span className="text-[10px] uppercase tracking-wider text-stone-500 border border-stone-300 rounded px-1.5 py-0.5">
                  ground truth
                </span>
              </div>
              <div className="flex items-baseline gap-4">
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-stone-400">
                    Total over {parsed!.runs} run{parsed!.runs === 1 ? "" : "s"}
                  </span>
                  <p className="text-lg font-mono font-semibold text-stone-900">
                    {formatCost(reconstruction.totalComputed)}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-stone-400">
                    Avg / run
                  </span>
                  <p className="text-sm font-mono text-stone-700">
                    {formatCost(reconstruction.totalComputed / parsed!.runs)}
                  </p>
                </div>
                {anchorModel && (
                  <div>
                    <span className="text-[11px] uppercase tracking-wider text-stone-400">
                      On original model
                    </span>
                    <p className="text-sm text-stone-700">{anchorModel.name}</p>
                  </div>
                )}
              </div>
              {reconstruction.warnings.length > 0 && (
                <ul className="text-[11px] text-amber-700 list-disc list-inside space-y-0.5">
                  {reconstruction.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Derived from the provider&rsquo;s raw token usage as billed —
                exact cache read/write tiers and batch flag, no verbosity estimate.
                This is what the captured run cost on its original model. Compare
                to the projection below, which estimates cost on each model using
                a per-model verbosity multiplier. Billed &plusmn;5% accuracy is
                not verified (no invoice linked).
              </p>
            </div>
          )}

          {/* Counterfactual table */}
          {rows && rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                  Cross-model projection
                </h3>
                {/* Effective ⇄ Nominal toggle */}
                <div
                  className="flex items-center gap-1 text-[11px]"
                  title={multiplierTooltip}
                >
                  <button
                    type="button"
                    onClick={() => setCostMode("effective")}
                    className={`px-2 py-1 rounded-l-md border transition-colors ${
                      costMode === "effective"
                        ? "bg-stone-800 text-white border-stone-800"
                        : "bg-white text-stone-500 border-stone-200 hover:text-stone-700"
                    }`}
                  >
                    Effective
                  </button>
                  <button
                    type="button"
                    onClick={() => setCostMode("nominal")}
                    className={`px-2 py-1 border -ml-px transition-colors ${
                      costMode === "nominal"
                        ? "bg-stone-800 text-white border-stone-800"
                        : "bg-white text-stone-500 border-stone-200 hover:text-stone-700"
                    }`}
                  >
                    Nominal
                  </button>
                  <button
                    type="button"
                    onClick={() => setCostMode("retokenized")}
                    disabled={retokenizedRows === null}
                    title={
                      retokenizedRows === null
                        ? "Re-tokenize unavailable (no captured trace)."
                        : retokenizedTooltip
                    }
                    className={`px-2 py-1 rounded-r-md border -ml-px transition-colors ${
                      costMode === "retokenized"
                        ? "bg-stone-800 text-white border-stone-800"
                        : "bg-white text-stone-500 border-stone-200 hover:text-stone-700"
                    }${retokenizedRows === null ? " opacity-40 cursor-not-allowed" : ""}`}
                  >
                    Retokenized
                  </button>
                  <span className="ml-1 text-stone-300 cursor-help" title={costMode === "retokenized" ? retokenizedTooltip : multiplierTooltip}>
                    ⓘ
                  </span>
                </div>
              </div>

              {costMode !== "retokenized" && (
                <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-400 border-b border-stone-100">
                      <th className="font-medium py-1.5 pr-2">Model</th>
                      <th className="font-medium py-1.5 px-2 text-right">
                        {costMode === "effective" ? "Eff. out tok" : "Out tok"}
                      </th>
                      <th className="font-medium py-1.5 px-2 text-right">
                        $/mo
                      </th>
                      <th className="font-medium py-1.5 pl-2 text-right">
                        Δ% vs run
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.model.id}
                        className={`border-b border-stone-50 ${
                          r.isAnchor ? "bg-stone-100" : ""
                        }`}
                      >
                        <td className="py-1.5 pr-2">
                          <span
                            className={
                              r.isAnchor
                                ? "font-semibold text-stone-900"
                                : "text-stone-600"
                            }
                          >
                            {r.model.name}
                          </span>
                          {r.isAnchor && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wider text-stone-500 border border-stone-300 rounded px-1 py-0.5">
                              your run
                            </span>
                          )}
                          {r.model.isOpen && (
                            <span className="ml-1 text-[9px] uppercase tracking-wider text-stone-400">
                              open
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-stone-500">
                          {Math.round(r.effectiveOutputTokens).toLocaleString()}
                          {costMode === "effective" &&
                            r.multiplierUsed !== 1 && (
                              <span className="text-stone-300">
                                {" "}
                                ({r.multiplierUsed}×)
                              </span>
                            )}
                        </td>
                        <td
                          className={`py-1.5 px-2 text-right font-mono ${
                            r.isAnchor
                              ? "font-semibold text-stone-900"
                              : "text-stone-700"
                          }`}
                        >
                          {formatCost(r.breakdown.totalPerMonth)}
                        </td>
                        <td className="py-1.5 pl-2 text-right font-mono">
                          {r.deltaVsAnchorPct === null ? (
                            <span className="text-stone-300">—</span>
                          ) : (
                            <span
                              className={
                                r.deltaVsAnchorPct < 0
                                  ? "text-emerald-600"
                                  : "text-red-500"
                              }
                            >
                              {r.deltaVsAnchorPct > 0 ? "+" : ""}
                              {r.deltaVsAnchorPct}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-stone-400 leading-relaxed">
                {costMode === "effective"
                  ? "Effective = output tokens normalized by each model's verbosity multiplier, then priced. Reasoning models emit more tokens per task."
                  : "Nominal = raw list price at identical output tokens. Ignores that verbose/reasoning models emit more tokens per task."}
              </p>
                </>
              )}

              {costMode === "retokenized" && retokenizedRows && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-stone-400 border-b border-stone-100">
                          <th className="font-medium py-1.5 pr-2">Model</th>
                          <th className="font-medium py-1.5 px-2 text-right">
                            Target out tok
                          </th>
                          <th className="font-medium py-1.5 px-2 text-right">
                            $/run
                          </th>
                          <th className="font-medium py-1.5 pl-2 text-right">
                            Method
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {retokenizedRows.map((r) => (
                          <tr
                            key={r.model.id}
                            className={`border-b border-stone-50 ${
                              r.model.id === profiledConfig?.modelId
                                ? "bg-stone-100"
                                : ""
                            }`}
                          >
                            <td className="py-1.5 pr-2">
                              <span
                                className={
                                  r.model.id === profiledConfig?.modelId
                                    ? "font-semibold text-stone-900"
                                    : "text-stone-600"
                                }
                              >
                                {r.model.name}
                              </span>
                              {r.model.id === profiledConfig?.modelId && (
                                <span className="ml-1.5 text-[9px] uppercase tracking-wider text-stone-500 border border-stone-300 rounded px-1 py-0.5">
                                  your run
                                </span>
                              )}
                              {r.model.isOpen && (
                                <span className="ml-1 text-[9px] uppercase tracking-wider text-stone-400">
                                  open
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-stone-500">
                              {r.targetOutputTokens.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-stone-700">
                              {formatCost(r.perRunCost)}
                            </td>
                            <td className="py-1.5 pl-2 text-right">
                              <span
                                title={r.notes.join(" ")}
                                className={
                                  r.isExact
                                    ? "text-emerald-600 font-mono"
                                    : "text-amber-600 font-mono"
                                }
                              >
                                {r.method}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-stone-400 leading-relaxed">
                    Retokenized = the captured run&rsquo;s output text, re-tokenized under each model&rsquo;s tokenizer, priced at list rates (no cache, no batch). Exact for OpenAI; approx for Claude/Gemini. This isolates the tokenizer effect — it does NOT model a different model emitting more/fewer tokens (that is Phase 3 replay).
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── C5 — Task DNA card ──────────────────────────────────────── */}
          {parsed && classification && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-4 space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  Task DNA
                </h3>
                <span className="text-[10px] text-stone-400">
                  classified from your trace&rsquo;s behavior — adjust if it&rsquo;s
                  off
                </span>
              </div>

              {/* Detected type + complexity, each with a confidence indicator */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-stone-400">
                    Task type
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-stone-800 capitalize">
                      {effectiveType ?? "unknown"}
                    </span>
                    {typeOverridden && (
                      <span className="text-[9px] uppercase tracking-wider text-stone-500 border border-stone-300 rounded px-1 py-0.5">
                        overridden
                      </span>
                    )}
                  </div>
                  <ConfidenceBar
                    value={typeOverridden ? 1 : classification.taskTypeConfidence}
                    label={
                      typeOverridden
                        ? "manual"
                        : `${Math.round(
                            (classification.taskTypeConfidence ?? 0) * 100,
                          )}% confidence`
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-stone-400">
                    Complexity
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-stone-800 capitalize">
                      {effectiveComplexity ?? "unknown"}
                    </span>
                    {complexityOverridden && (
                      <span className="text-[9px] uppercase tracking-wider text-stone-500 border border-stone-300 rounded px-1 py-0.5">
                        overridden
                      </span>
                    )}
                  </div>
                  <ConfidenceBar
                    value={
                      complexityOverridden
                        ? 1
                        : classification.complexityConfidence
                    }
                    label={
                      complexityOverridden
                        ? "manual"
                        : `${Math.round(
                            (classification.complexityConfidence ?? 0) * 100,
                          )}% confidence`
                    }
                  />
                </div>
              </div>

              {/* Evidence chips */}
              {classification.evidence && classification.evidence.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-stone-400">
                    Evidence
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {classification.evidence.map((e, i) => (
                      <span
                        key={i}
                        className="text-[11px] text-stone-600 bg-white border border-stone-200 rounded-full px-2.5 py-1"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendation line */}
              <div className="rounded-md border border-stone-200 bg-white px-4 py-3 space-y-1.5">
                {recommendation && recommendation.recommended ? (
                  <p className="text-sm text-stone-700">
                    <span className="font-semibold">Cheapest capable:</span>{" "}
                    <span className="font-semibold text-stone-900">
                      {recommendation.recommended.name}
                    </span>{" "}
                    — save{" "}
                    <span className="font-semibold font-mono">
                      {formatCost(recommendation.monthlySaving)}/mo
                    </span>
                    .{" "}
                    <span className="text-stone-500">
                      Why: {recommendation.rationale}
                    </span>
                  </p>
                ) : recommendation ? (
                  <p className="text-sm text-stone-700">
                    <span className="font-semibold">Already optimal.</span>{" "}
                    <span className="text-stone-500">
                      {recommendation.rationale}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-stone-400">
                    Recommendation unavailable — the anchor model couldn&rsquo;t be
                    resolved from this trace. Use the cross-model table above to
                    compare cost directly.
                  </p>
                )}
                {recommendation &&
                  recommendation.caveats &&
                  recommendation.caveats.length > 0 && (
                    <ul className="list-disc list-inside text-[11px] text-stone-400 space-y-0.5">
                      {recommendation.caveats.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
              </div>

              {/* Override controls — changing either re-runs the recommendation */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-stone-400">
                  Override — re-runs the recommendation
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-500">Task type</span>
                    <select
                      value={typeOverride ?? ""}
                      onChange={(e) =>
                        setTypeOverride(
                          e.target.value === ""
                            ? null
                            : (e.target.value as TaskType),
                        )
                      }
                      className="w-full text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 text-stone-700 focus:outline-none focus:border-stone-400"
                    >
                      <option value="">Auto ({classification.taskType})</option>
                      {(
                        [
                          "coding",
                          "extraction",
                          "research",
                          "agentic",
                          "reasoning",
                          "chat",
                        ] as TaskType[]
                      ).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-stone-500">Complexity</span>
                    <select
                      value={complexityOverride ?? ""}
                      onChange={(e) =>
                        setComplexityOverride(
                          e.target.value === ""
                            ? null
                            : (e.target.value as Complexity),
                        )
                      }
                      className="w-full text-sm rounded-md border border-stone-200 bg-white px-2 py-1.5 text-stone-700 focus:outline-none focus:border-stone-400"
                    >
                      <option value="">
                        Auto ({classification.complexity})
                      </option>
                      {(["low", "med", "high"] as Complexity[]).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {(typeOverridden || complexityOverridden) && (
                  <button
                    type="button"
                    onClick={() => {
                      setTypeOverride(null);
                      setComplexityOverride(null);
                    }}
                    className="text-[11px] text-stone-400 hover:text-stone-700 underline underline-offset-2"
                  >
                    Reset to auto-detected
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// Pull only the user-tunable slider fields off the live config so the
// counterfactual re-projects when the user nudges sliders after profiling,
// while keeping the trace-derived anchor model fixed to the profiled run.
function sliderOverrides(c: AgentConfig): Partial<AgentConfig> {
  return {
    systemPromptTokens: c.systemPromptTokens,
    inputTokensPerRun: c.inputTokensPerRun,
    outputTokensPerRun: c.outputTokensPerRun,
    toolCallsPerRun: c.toolCallsPerRun,
    tokensPerToolCall: c.tokensPerToolCall,
    cacheHitRate: c.cacheHitRate,
    runsPerDay: c.runsPerDay,
  };
}

export default function Home() {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [tierFilter, setTierFilter] = useState<Set<Tier>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<"closed" | "open">>(new Set());
  const [strengthFilter, setStrengthFilter] = useState<Set<Strength>>(new Set());

  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const filteredModels = useMemo(
    () => filterModels(MODELS, tierFilter, typeFilter, strengthFilter),
    [tierFilter, typeFilter, strengthFilter]
  );

  // If the currently selected model is filtered out, fall back to first match
  useEffect(() => {
    if (filteredModels.length === 0) return;
    if (!filteredModels.some((m) => m.id === config.modelId)) {
      set("modelId", filteredModels[0].id);
    }
  }, [filteredModels, config.modelId]);

  const selectedModel =
    MODELS.find((m) => m.id === config.modelId) ?? MODELS[0];
  const breakdown = useMemo(() => calculateCost(config), [config]);

  const allBreakdowns = useMemo(
    () =>
      filteredModels
        .map((m) => ({
          model: m,
          cost: calculateCost({ ...config, modelId: m.id }),
        }))
        .sort((a, b) => a.cost.totalPerRun - b.cost.totalPerRun),
    [config, filteredModels]
  );

  const maxCost = Math.max(...allBreakdowns.map((b) => b.cost.totalPerRun), 0);
  const activeFilterCount =
    tierFilter.size + typeFilter.size + strengthFilter.size;

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-12">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            Agent Cost Calculator
          </h1>
          {/* Tab switcher */}
          <div className="flex items-center gap-2 pt-2">
            <a
              href="/"
              className="px-4 py-2 text-sm font-medium rounded-lg bg-stone-800 text-white"
            >
              Cost Estimator
            </a>
            <a
              href="/trace"
              className="px-4 py-2 text-sm font-medium rounded-lg text-stone-500 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            >
              Trace Analyzer
            </a>
          </div>
          <p className="text-stone-500 text-sm leading-relaxed max-w-xl">
            Model the real cost of running an AI agent — before you scale.
            Adjust inputs below to see cost per run, per day, and per month.
          </p>
        </div>

        {/* S4 — Paste a real run (profiler) — sits above the sliders */}
        <TracePanel config={config} onProfiled={(cfg) => setConfig(cfg)} />

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Config Panel */}
          <div className="lg:col-span-3 space-y-8">
            {/* Model selector + filters */}
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                  Model
                </h2>
                <span className="text-xs text-stone-400">
                  {filteredModels.length} of {MODELS.length}
                </span>
              </div>

              {/* Filter rows */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-stone-400 mr-1">
                    Tier
                  </span>
                  {TIERS.map((t) => (
                    <Chip
                      key={t}
                      label={TIER_LABEL[t]}
                      active={tierFilter.has(t)}
                      onToggle={() =>
                        setTierFilter(toggleSet(tierFilter, t))
                      }
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-stone-400 mr-1">
                    Type
                  </span>
                  {(["closed", "open"] as const).map((t) => (
                    <Chip
                      key={t}
                      label={t === "closed" ? "Closed" : "Open-weights"}
                      active={typeFilter.has(t)}
                      onToggle={() =>
                        setTypeFilter(toggleSet(typeFilter, t))
                      }
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-stone-400 mr-1">
                    Strength
                  </span>
                  {STRENGTHS.map((s) => (
                    <Chip
                      key={s}
                      label={STRENGTH_LABEL[s]}
                      active={strengthFilter.has(s)}
                      onToggle={() =>
                        setStrengthFilter(toggleSet(strengthFilter, s))
                      }
                    />
                  ))}
                </div>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTierFilter(new Set());
                      setTypeFilter(new Set());
                      setStrengthFilter(new Set());
                    }}
                    className="text-xs text-stone-400 hover:text-stone-700 underline underline-offset-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {/* Model table — replaces the old picker grid + comparison list.
                  One UI: filtered models sorted cheapest-first, click a row to
                  select it. Tier-colored accents + strength pills. */}
              <ModelTable
                rows={allBreakdowns}
                maxCost={maxCost}
                selectedId={config.modelId}
                onSelect={(id) => set("modelId", id)}
              />
            </section>

            {/* Token inputs */}
            <section className="space-y-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Token Profile
              </h2>
              <Slider
                label="System prompt / context"
                value={config.systemPromptTokens}
                min={0}
                max={32000}
                step={500}
                onChange={(v) => set("systemPromptTokens", v)}
                format={(v) => `${v.toLocaleString()} tokens`}
                hint="Usually cached — docs, instructions, retrieved context"
              />
              <Slider
                label="Input per run"
                value={config.inputTokensPerRun}
                min={100}
                max={16000}
                step={100}
                onChange={(v) => set("inputTokensPerRun", v)}
                format={(v) => `${v.toLocaleString()} tokens`}
                hint="User message + any per-run dynamic context"
              />
              <Slider
                label="Output per run"
                value={config.outputTokensPerRun}
                min={50}
                max={8000}
                step={50}
                onChange={(v) => set("outputTokensPerRun", v)}
                format={(v) => `${v.toLocaleString()} tokens`}
              />
            </section>

            {/* Tool calls */}
            <section className="space-y-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Tool Calls
              </h2>
              <Slider
                label="Tool calls per run"
                value={config.toolCallsPerRun}
                min={0}
                max={20}
                step={1}
                onChange={(v) => set("toolCallsPerRun", v)}
                format={(v) => `${v} calls`}
                hint="Each call adds an extra input + output round"
              />
              <Slider
                label="Tokens per tool call"
                value={config.tokensPerToolCall}
                min={50}
                max={2000}
                step={50}
                onChange={(v) => set("tokensPerToolCall", v)}
                format={(v) => `${v} tokens avg`}
              />
            </section>

            {/* Cache */}
            {selectedModel.supportsCache && (
              <section className="space-y-5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                  Prompt Caching
                </h2>
                <Slider
                  label="Cache hit rate"
                  value={config.cacheHitRate}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => set("cacheHitRate", v)}
                  format={(v) => `${Math.round(v * 100)}%`}
                  hint="How often the system prompt is served from cache"
                />
              </section>
            )}

            {/* Volume */}
            <section className="space-y-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Volume
              </h2>
              <Slider
                label="Runs per day"
                value={config.runsPerDay}
                min={1}
                max={10000}
                step={10}
                onChange={(v) => set("runsPerDay", v)}
                format={(v) => v.toLocaleString()}
              />
            </section>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Cost summary */}
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Cost Estimate
              </h2>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-stone-500">Per run</span>
                  <span className="text-xl font-semibold font-mono text-stone-900">
                    {formatCost(breakdown.totalPerRun)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-stone-500">Per day</span>
                  <span className="text-base font-mono text-stone-700">
                    {formatCost(breakdown.totalPerDay)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-stone-500">Per month</span>
                  <span className="text-base font-mono text-stone-700">
                    {formatCost(breakdown.totalPerMonth)}
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-stone-100 space-y-3">
                <p className="text-xs text-stone-400 uppercase tracking-wider font-semibold">
                  Breakdown
                </p>
                <CostBar
                  label="Uncached input"
                  value={breakdown.inputCost}
                  total={breakdown.totalPerRun}
                  color="bg-stone-700"
                />
                {selectedModel.supportsCache && (
                  <>
                    <CostBar
                      label="Cached reads"
                      value={breakdown.cachedInputCost}
                      total={breakdown.totalPerRun}
                      color="bg-stone-400"
                    />
                    <CostBar
                      label="Cache writes"
                      value={breakdown.cacheWriteCost}
                      total={breakdown.totalPerRun}
                      color="bg-stone-300"
                    />
                  </>
                )}
                <CostBar
                  label="Output"
                  value={breakdown.outputCost}
                  total={breakdown.totalPerRun}
                  color="bg-amber-500"
                />
                <CostBar
                  label="Tool calls"
                  value={breakdown.toolCallCost}
                  total={breakdown.totalPerRun}
                  color="bg-blue-400"
                />
              </div>

              <p className="text-xs text-stone-400 pt-1">
                Prices fetched {PRICING_FETCHED_AT.slice(0, 10)} from OpenRouter — verify against provider docs before scaling.
              </p>
            </div>

            {/* The model comparison list used to live here. It's been merged
                into the ModelTable above the sliders — one unified UI that
                serves as both picker and comparison. */}
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-stone-200 mt-8 pt-5 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
            <p className="text-stone-600">
              Built by{" "}
              <a
                href="https://github.com/saiviki"
                className="font-medium text-stone-800 underline underline-offset-2 hover:text-stone-900"
              >
                Sairam
              </a>{" "}
              <span className="text-stone-400">·</span>{" "}
              <span className="text-stone-500">
                Pricing via OpenRouter + provider docs
              </span>{" "}
              <span className="text-stone-400">·</span>{" "}
              <span className="text-stone-500">
                Lineup curated from real-usage rankings
              </span>
            </p>
            <p className="text-stone-400">
              Prices fetched {PRICING_FETCHED_AT.slice(0, 10)} from OpenRouter
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
