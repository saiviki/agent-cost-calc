"use client";

import { useState, useMemo } from "react";
import {
  MODELS,
  calculateCost,
  formatCost,
  type AgentConfig,
} from "@/lib/models";

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

export default function Home() {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);

  const set = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const breakdown = useMemo(() => calculateCost(config), [config]);

  const selectedModel = MODELS.find((m) => m.id === config.modelId)!;

  const allBreakdowns = useMemo(
    () =>
      MODELS.map((m) => ({
        model: m,
        cost: calculateCost({ ...config, modelId: m.id }),
      })).sort((a, b) => a.cost.totalPerRun - b.cost.totalPerRun),
    [config]
  );

  const maxCost = Math.max(...allBreakdowns.map((b) => b.cost.totalPerRun));

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-12">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
            Agent Cost Calculator
          </h1>
          <p className="text-stone-500 text-sm leading-relaxed max-w-xl">
            Model the real cost of running an AI agent — before you scale.
            Adjust inputs below to see cost per run, per day, and per month.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Config Panel */}
          <div className="lg:col-span-3 space-y-8">
            {/* Model selector */}
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Model
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => set("modelId", m.id)}
                    className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                      config.modelId === m.id
                        ? "border-stone-800 bg-stone-800 text-white"
                        : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
                    }`}
                  >
                    <div className="font-medium">{m.name}</div>
                    <div
                      className={`text-xs mt-0.5 ${
                        config.modelId === m.id
                          ? "text-stone-300"
                          : "text-stone-400"
                      }`}
                    >
                      {m.provider} · ${m.inputPricePerM}/${m.outputPricePerM}
                      /M
                    </div>
                  </button>
                ))}
              </div>
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

              <p className="text-xs text-stone-300 pt-1">
                Prices verified May 2026 — verify against provider docs before scaling.
              </p>
            </div>

            {/* Model comparison */}
            <div className="bg-white border border-stone-200 rounded-xl p-5 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Model Comparison (same config)
              </h2>
              <div className="space-y-3">
                {allBreakdowns.map(({ model, cost }) => (
                  <div key={model.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span
                        className={
                          model.id === config.modelId
                            ? "font-semibold text-stone-900"
                            : "text-stone-500"
                        }
                      >
                        {model.name}
                      </span>
                      <span className="font-mono text-stone-700">
                        {formatCost(cost.totalPerRun)}/run
                      </span>
                    </div>
                    <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          model.id === config.modelId
                            ? "bg-stone-800"
                            : "bg-stone-300"
                        }`}
                        style={{
                          width: `${maxCost > 0 ? (cost.totalPerRun / maxCost) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-stone-300 pt-4">
          Built by{" "}
          <a
            href="https://github.com/saiviki"
            className="underline underline-offset-2 hover:text-stone-500"
          >
            Sai Viki
          </a>{" "}
          · Pricing sourced from provider docs · Not affiliated with any model provider
        </div>
      </div>
    </main>
  );
}
