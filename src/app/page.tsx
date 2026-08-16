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
  type CostBreakdown,
} from "@/lib/models";
import {
  parseUsagePaste,
  PasteUsageError,
  type ParsedUsageConfig,
} from "@/lib/pasteUsage";

const DEFAULT_CONFIG: AgentConfig = {
  modelId: "claude-sonnet-4-6",
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

const PASTE_EXAMPLE = `{
  "model_id": "claude-sonnet-4-6",
  "spans": [
    { "input_tokens": 4200, "output_tokens": 890, "cached_tokens": 1800, "tool_name": "retriever" },
    { "input_tokens": 800, "output_tokens": 110 }
  ]
}`;

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          {label}
        </label>
        <span className="text-sm font-mono font-semibold text-stone-900 tabular-nums">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-stone-200 accent-stone-800 cursor-pointer"
      />
    </div>
  );
}

function Chip({
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

type ModelRow = { model: (typeof MODELS)[number]; cost: CostBreakdown };

function ModelTable({
  rows,
  maxCost,
  selectedId,
  viewMode = "task",
  onSelect,
}: {
  rows: ModelRow[];
  maxCost: number;
  selectedId: string;
  viewMode?: "task" | "day" | "month";
  onSelect: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-stone-400 italic py-4 text-center border border-dashed border-stone-200 rounded-lg">
        No models match these filters.
      </div>
    );
  }

  const costHeader =
    viewMode === "task"
      ? "Cost / Task"
      : viewMode === "day"
        ? "Cost / Day"
        : "Cost / Month";

  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-stone-500 px-3 py-2.5">
              Model
            </th>
            <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-stone-500 px-3 py-2.5 hidden sm:table-cell">
              Strengths
            </th>
            <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-stone-500 px-3 py-2.5 hidden md:table-cell">
              Price /M
            </th>
            <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-stone-500 px-3 py-2.5 hidden md:table-cell">
              Ctx
            </th>
            <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-stone-500 px-3 py-2.5 w-[25%] min-w-[140px]">
              {costHeader}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ model, cost }) => {
            const selected = model.id === selectedId;
            const displayCost =
              viewMode === "task"
                ? cost.totalPerRun
                : viewMode === "day"
                  ? cost.totalPerDay
                  : cost.totalPerMonth;
            const pct = maxCost > 0 ? (displayCost / maxCost) * 100 : 0;

            return (
              <tr
                key={model.id}
                onClick={() => onSelect(model.id)}
                className={`cursor-pointer border-b border-stone-100 last:border-0 transition-colors ${
                  selected ? TIER_SELECTED_ROW[model.tier] : "hover:bg-stone-50"
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
                      <div className="text-[11px] text-stone-500 flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${TIER_DOT[model.tier]}`}
                        />
                        {TIER_LABEL[model.tier]} · {model.modelDeveloper}
                        {model.pricingProvider !== model.modelDeveloper && (
                          <span> · priced via {model.pricingProvider}</span>
                        )}
                        {model.pricingStatus === "carried-forward" && (
                          <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-50 text-amber-800">
                            carried-forward
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {model.strengths.slice(0, 3).map((s) => (
                      <span
                        key={s}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600"
                      >
                        {STRENGTH_LABEL[s]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right hidden md:table-cell font-mono text-xs text-stone-600 tabular-nums">
                  <div>${model.inputPricePerM.toFixed(2)}</div>
                  <div className="text-stone-400">
                    ${model.outputPricePerM.toFixed(2)} out
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right hidden md:table-cell font-mono text-xs text-stone-600 tabular-nums">
                  {model.contextK}k
                </td>
                <td className="px-3 py-2.5">
                  <div className="space-y-1">
                    <div className="text-right font-mono font-semibold text-stone-900 tabular-nums">
                      {formatCost(displayCost)}
                    </div>
                    <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${TIER_BAR[model.tier]} opacity-70`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
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

function PasteUsagePanel({
  onApply,
}: {
  onApply: (cfg: ParsedUsageConfig) => void;
}) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const apply = () => {
    try {
      const cfg = parseUsagePaste(raw);
      onApply(cfg);
      setError(null);
      setApplied(true);
    } catch (e) {
      setApplied(false);
      setError(e instanceof PasteUsageError ? e.message : "Could not parse paste.");
    }
  };

  return (
    <details className="bg-white border border-stone-200 rounded-xl p-5 group">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Paste usage
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            Optional: paste simple JSON or CSV to fill the sliders below.
          </p>
        </div>
        <span className="text-stone-400 text-sm group-open:rotate-90 transition-transform">
          ▸
        </span>
      </summary>

      <div className="mt-4 space-y-3">
        <textarea
          aria-label="Usage paste"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setApplied(false);
            setError(null);
          }}
          placeholder={PASTE_EXAMPLE}
          rows={8}
          className="w-full font-mono text-xs rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={apply}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-stone-800 text-white hover:bg-stone-700 transition-colors"
          >
            Apply to sliders
          </button>
          <button
            type="button"
            onClick={() => {
              setRaw(PASTE_EXAMPLE);
              setError(null);
              setApplied(false);
            }}
            className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2"
          >
            Load example
          </button>
          {applied && (
            <span className="text-xs text-emerald-700">Sliders updated.</span>
          )}
          {error && (
            <span role="alert" className="text-xs text-red-600">
              {error}
            </span>
          )}
        </div>
        <p className="text-[11px] text-stone-400 leading-relaxed">
          Unquoted CSV only (quoted fields are rejected). Header:{" "}
          <code className="text-stone-500">
            input_tokens,output_tokens,cached_tokens,tool_name,model_id
          </code>
          . System prompt is set to 0 (not in the format). Runs/day is left
          unchanged.
        </p>
      </div>
    </details>
  );
}

export default function Home() {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [tierFilter, setTierFilter] = useState<Set<Tier>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<"closed" | "open">>(new Set());
  const [strengthFilter, setStrengthFilter] = useState<Set<Strength>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [viewMode, setViewMode] = useState<"task" | "day" | "month">("task");
  const [applyMultiplier, setApplyMultiplier] = useState(true);

  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const providers = useMemo(
    () => Array.from(new Set(MODELS.map((m) => m.provider))).sort(),
    [],
  );

  const filteredModels = useMemo(
    () =>
      filterModels(
        MODELS,
        tierFilter,
        typeFilter,
        strengthFilter,
        searchQuery,
        providerFilter,
      ),
    [tierFilter, typeFilter, strengthFilter, searchQuery, providerFilter],
  );

  useEffect(() => {
    if (filteredModels.length === 0) return;
    if (!filteredModels.some((m) => m.id === config.modelId)) {
      set("modelId", filteredModels[0].id);
    }
  }, [filteredModels, config.modelId]);

  const selectedModel =
    MODELS.find((m) => m.id === config.modelId) ?? MODELS[0];

  const allBreakdowns = useMemo(
    () =>
      filteredModels
        .map((m) => ({
          model: m,
          cost: calculateCost({ ...config, modelId: m.id }, m, {
            applyMultiplier,
          }),
        }))
        .sort((a, b) => {
          const getDisplayCost = (c: CostBreakdown) =>
            viewMode === "task"
              ? c.totalPerRun
              : viewMode === "day"
                ? c.totalPerDay
                : c.totalPerMonth;
          return getDisplayCost(a.cost) - getDisplayCost(b.cost);
        }),
    [config, filteredModels, applyMultiplier, viewMode],
  );

  const maxCost = Math.max(
    ...allBreakdowns.map((b) =>
      viewMode === "task"
        ? b.cost.totalPerRun
        : viewMode === "day"
          ? b.cost.totalPerDay
          : b.cost.totalPerMonth,
    ),
    0,
  );

  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    tierFilter,
    typeFilter,
    strengthFilter,
    searchQuery,
    providerFilter,
    viewMode,
    applyMultiplier,
  ]);

  const totalPages = Math.max(1, Math.ceil(allBreakdowns.length / PAGE_SIZE));

  const paginatedBreakdowns = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return allBreakdowns.slice(start, start + PAGE_SIZE);
  }, [allBreakdowns, currentPage]);

  const activeFilterCount =
    tierFilter.size +
    typeFilter.size +
    strengthFilter.size +
    (searchQuery ? 1 : 0) +
    (providerFilter ? 1 : 0);

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-12">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            Agent Cost Calculator
          </h1>
          <p className="text-stone-500 text-sm leading-relaxed max-w-xl">
            Model the real cost of running an AI agent — before you scale.
            Adjust inputs below to see cost per run, per day, and per month.
          </p>
        </div>

        <PasteUsagePanel
          onApply={(partial) => setConfig((c) => ({ ...c, ...partial }))}
        />

        <section className="bg-white border border-stone-200 rounded-xl p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-4">
            Cost inputs
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-5">
            <Slider
              label="System prompt"
              value={config.systemPromptTokens}
              min={0}
              max={32000}
              step={500}
              onChange={(v) => set("systemPromptTokens", v)}
              format={(v) => `${v.toLocaleString()} tok`}
            />
            <Slider
              label="Input / run"
              value={config.inputTokensPerRun}
              min={100}
              max={16000}
              step={100}
              onChange={(v) => set("inputTokensPerRun", v)}
              format={(v) => `${v.toLocaleString()} tok`}
            />
            <Slider
              label="Output / run"
              value={config.outputTokensPerRun}
              min={50}
              max={8000}
              step={50}
              onChange={(v) => set("outputTokensPerRun", v)}
              format={(v) => `${v.toLocaleString()} tok`}
            />
            <Slider
              label="Tool calls / run"
              value={config.toolCallsPerRun}
              min={0}
              max={20}
              step={1}
              onChange={(v) => set("toolCallsPerRun", v)}
              format={(v) => `${v}`}
            />
            <Slider
              label="Tokens / tool call"
              value={config.tokensPerToolCall}
              min={0}
              max={2000}
              step={50}
              onChange={(v) => set("tokensPerToolCall", v)}
              format={(v) => `${v.toLocaleString()}`}
            />
            <Slider
              label="Runs / day"
              value={config.runsPerDay}
              min={1}
              max={10000}
              step={10}
              onChange={(v) => set("runsPerDay", v)}
              format={(v) => v.toLocaleString()}
            />
            {selectedModel.supportsCache && (
              <Slider
                label="Cache hit rate"
                value={config.cacheHitRate}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => set("cacheHitRate", v)}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Models
            </h2>
            <span className="text-xs text-stone-500">
              {filteredModels.length} of {MODELS.length}
            </span>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models or providers..."
                className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:border-stone-400"
              />
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="w-full text-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-800 focus:outline-none focus:border-stone-400"
              >
                <option value="">All Providers ({providers.length})</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-stone-500 mr-1">
                Tier
              </span>
              {TIERS.map((t) => (
                <Chip
                  key={t}
                  label={TIER_LABEL[t]}
                  active={tierFilter.has(t)}
                  onToggle={() => setTierFilter(toggleSet(tierFilter, t))}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-stone-500 mr-1">
                Type
              </span>
              {(["closed", "open"] as const).map((t) => (
                <Chip
                  key={t}
                  label={t === "closed" ? "Closed" : "Open-weights"}
                  active={typeFilter.has(t)}
                  onToggle={() => setTypeFilter(toggleSet(typeFilter, t))}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-stone-500 mr-1">
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
                  setSearchQuery("");
                  setProviderFilter("");
                }}
                className="text-xs text-stone-400 hover:text-stone-700 underline underline-offset-2"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-stone-100/80 p-3 rounded-lg border border-stone-200">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 mr-1">
                View:
              </span>
              {(["task", "day", "month"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    viewMode === mode
                      ? "bg-stone-800 text-white shadow-sm"
                      : "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  {mode === "task"
                    ? "Per Task"
                    : mode === "day"
                      ? `Per Day (${config.runsPerDay.toLocaleString()} runs)`
                      : `Per Month (${(config.runsPerDay * 30).toLocaleString()} runs)`}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-stone-700 select-none">
              <input
                type="checkbox"
                checked={applyMultiplier}
                onChange={(e) => setApplyMultiplier(e.target.checked)}
                className="rounded accent-stone-800 cursor-pointer"
              />
              <span className="font-medium">Reasoning Expansion</span>
            </label>
          </div>

          <ModelTable
            rows={paginatedBreakdowns}
            maxCost={maxCost}
            selectedId={config.modelId}
            viewMode={viewMode}
            onSelect={(id) => set("modelId", id)}
          />

          {allBreakdowns.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <span className="text-xs text-stone-500">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, allBreakdowns.length)} of{" "}
                {allBreakdowns.length} models
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs font-mono font-medium text-stone-600 px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>

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
                Pricing via{" "}
                <a
                  href="https://models.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-stone-700 underline underline-offset-2 hover:text-stone-900"
                >
                  models.dev
                </a>
              </span>
            </p>
            <p className="text-stone-400">
              Fetched {PRICING_FETCHED_AT.slice(0, 10)} from models.dev/catalog.json
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}
