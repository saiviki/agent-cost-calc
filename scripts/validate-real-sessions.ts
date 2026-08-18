#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { MODELS } from "../src/lib/models";

type Totals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  reasoningOutput: number;
};

type Row = {
  kind: "claude" | "codex";
  file: string;
  model: string;
  messages: number;
  totals: Totals;
  computedCost: number | null;
  invoiceCost: number | null;
  invoiceErrorPct: number | null;
  pass: boolean | null;
  blockedReason: string | null;
};

const LIMIT = Number(process.env.REAL_SESSION_LIMIT ?? 3);
const INVOICE_FIXTURE = process.env.REAL_SESSION_INVOICES ?? "fixtures/real-session-invoices.json";

const emptyTotals = (): Totals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  reasoningOutput: 0,
});

const n = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

function modelFor(id: string) {
  const alias =
    id === "claude-opus-4-8"
      ? "claude-opus-4-7"
      : id === "claude-sonnet-5"
        ? "claude-sonnet-4-6"
        : id;
  return MODELS.find((m) => m.id === alias || m.name === alias) ?? null;
}

function cost(modelId: string, totals: Totals): number | null {
  const model = modelFor(modelId);
  if (!model) return null;
  return (
    (totals.input / 1e6) * model.inputPricePerM +
    (totals.output / 1e6) * model.outputPricePerM +
    (totals.cacheRead / 1e6) * (model.cacheReadPricePerM ?? 0) +
    (totals.cacheWrite5m / 1e6) * (model.cacheWritePricePerM ?? 0)
  );
}

function jsonl(file: string): unknown[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function findFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return execFileSync("find", [root, "-type", "f", "-name", "*.jsonl"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

function readInvoices(): Record<string, number> {
  if (!existsSync(INVOICE_FIXTURE)) return {};
  return JSON.parse(readFileSync(INVOICE_FIXTURE, "utf8"));
}

function claudeRows(invoices: Record<string, number>): Row[] {
  return findFiles(join(homedir(), ".claude/projects"))
    .map((file): Row | null => {
      const totals = emptyTotals();
      let messages = 0;
      let model = "";

      for (const item of jsonl(file) as any[]) {
        const usage = item.message?.usage ?? item.usage;
        if (!usage) continue;
        messages += 1;
        model ||= item.message?.model ?? item.model ?? "claude-sonnet-4-6";
        totals.input += n(usage.input_tokens);
        totals.output += n(usage.output_tokens);
        totals.cacheRead += n(usage.cache_read_input_tokens);
        totals.cacheWrite5m += n(usage.cache_creation_input_tokens);
      }

      if (!messages) return null;
      const computedCost = cost(model, totals);
      const invoiceCost = invoices[file] ?? invoices[file.split("/").pop() ?? ""] ?? null;
      const invoiceErrorPct =
        invoiceCost && computedCost != null ? Math.abs(computedCost - invoiceCost) / invoiceCost : null;
      return {
        kind: "claude",
        file,
        model,
        messages,
        totals,
        computedCost,
        invoiceCost,
        invoiceErrorPct,
        pass: invoiceErrorPct == null ? null : invoiceErrorPct <= 0.05,
        blockedReason: computedCost == null ? "no-pricing-model" : invoiceCost == null ? "no-invoice" : null,
      };
    })
    .filter((row): row is Row => row != null)
    .sort((a, b) => totalTokens(b) - totalTokens(a))
    .slice(0, LIMIT);
}

function codexRows(invoices: Record<string, number>): Row[] {
  return findFiles(join(homedir(), ".codex/sessions"))
    .map((file): Row | null => {
      let latest: any = null;
      let model = "gpt-5.5";

      for (const item of jsonl(file) as any[]) {
        if (item.type === "session_meta") {
          model = item.payload?.model ?? item.payload?.model_slug ?? model;
        }
        if (item.type === "event_msg" && item.payload?.type === "token_count") {
          latest = item.payload.info?.total_token_usage ?? latest;
        }
      }

      if (!latest) return null;
      const totals: Totals = {
        input: n(latest.input_tokens) - n(latest.cached_input_tokens),
        output: n(latest.output_tokens),
        cacheRead: n(latest.cached_input_tokens),
        cacheWrite5m: 0,
        reasoningOutput: n(latest.reasoning_output_tokens),
      };
      const computedCost = cost(model, totals);
      const invoiceCost = invoices[file] ?? invoices[file.split("/").pop() ?? ""] ?? null;
      const invoiceErrorPct =
        invoiceCost && computedCost != null ? Math.abs(computedCost - invoiceCost) / invoiceCost : null;
      return {
        kind: "codex",
        file,
        model,
        messages: 1,
        totals,
        computedCost,
        invoiceCost,
        invoiceErrorPct,
        pass: invoiceErrorPct == null ? null : invoiceErrorPct <= 0.05,
        blockedReason: computedCost == null ? "no-pricing-model" : invoiceCost == null ? "no-invoice" : null,
      };
    })
    .filter((row): row is Row => row != null)
    .sort((a, b) => totalTokens(b) - totalTokens(a))
    .slice(0, LIMIT);
}

function main() {
  const invoices = readInvoices();
  const rows = [...claudeRows(invoices), ...codexRows(invoices)];

  for (const row of rows) {
    console.log(
      [
        row.kind,
        row.pass == null ? `BLOCKED:${row.blockedReason}` : row.pass ? "PASS" : "FAIL",
        row.model,
        row.computedCost == null ? "cost=unknown" : `$${row.computedCost.toFixed(6)}`,
        row.invoiceCost == null ? "invoice=missing" : `invoice=$${row.invoiceCost.toFixed(6)}`,
        `input=${row.totals.input}`,
        `cacheRead=${row.totals.cacheRead}`,
        `cacheWrite=${row.totals.cacheWrite5m}`,
        `output=${row.totals.output}`,
        row.file,
      ].join("\t"),
    );
  }

  const tested = rows.filter((row) => row.pass != null);
  const blocked = rows.length - tested.length;
  const failed = tested.filter((row) => !row.pass).length;
  console.log(`\nsummary rows=${rows.length} invoice_tested=${tested.length} blocked=${blocked} failed=${failed}`);
  if (blocked || failed || rows.length < LIMIT * 2) process.exitCode = 1;
}

function totalTokens(row: Row): number {
  return row.totals.input + row.totals.output + row.totals.cacheRead + row.totals.cacheWrite5m;
}

main();
