// Operator tooling — Script B (docs/SPEC-phase3-replay.md §6).
// Runs the Phase 3 end-to-end replay: buildReplayPlan -> (real model B calls OR
// synthetic actuals) -> evaluateReplay.
//
// HONESTY (P4, load-bearing): --dry-run uses SYNTHETIC actuals constructed so
// prompt_tokens ~= countTokens(promptText, target); it makes ZERO network calls
// and proves the DRIVER PLUMBING ONLY, NOT accuracy (inputTokenDiffMedianPct is
// ~0 by construction). Real mode is the OPERATOR's to run with their own API key
// — it makes PAID calls. No empirical ±5% / P95 claim is made by this script.
//
// Usage:
//   npx tsx scripts/replay-driver.ts <traceFile> <targetModelId> [--api-model <id>] [--provider auto|anthropic|openai|gemini] [--calls <N>] [--dry-run]
//   npm run replay -- <traceFile> <targetModelId> --dry-run
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTrace, TraceParseError } from "../src/lib/parseTrace";
import { MODELS, type Model } from "../src/lib/models";
import { countTokens } from "../src/lib/tokenize";
import {
  buildReplayPlan,
  evaluateReplay,
  type ActualCall,
  type ReplayEvaluation,
  type ReplayPlan,
} from "../src/lib/replayHarness";

const __dirname = dirname(fileURLToPath(import.meta.url));

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

type Args = {
  traceFile: string;
  targetModelId: string;
  apiModel?: string;
  provider?: string;
  calls?: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let apiModel: string | undefined;
  let provider: string | undefined;
  let calls: number | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--api-model") {
      apiModel = argv[++i];
      continue;
    }
    if (a.startsWith("--api-model=")) {
      apiModel = a.slice("--api-model=".length);
      continue;
    }
    if (a === "--provider") {
      provider = argv[++i];
      continue;
    }
    if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
      continue;
    }
    if (a === "--calls") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        console.error(
          `invalid --calls value "${raw}": expected a non-negative integer`,
        );
        process.exit(1);
      }
      calls = n;
      continue;
    }
    if (a.startsWith("--calls=")) {
      const raw = a.slice("--calls=".length);
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        console.error(
          `invalid --calls value "${raw}": expected a non-negative integer`,
        );
        process.exit(1);
      }
      calls = n;
      continue;
    }
    positional.push(a);
  }
  if (positional.length < 2) {
    console.error(
      "Usage: npx tsx scripts/replay-driver.ts <traceFile> <targetModelId> [--api-model <id>] [--provider auto|anthropic|openai|gemini] [--calls <N>] [--dry-run]",
    );
    process.exit(1);
  }
  return {
    traceFile: positional[0],
    targetModelId: positional[1],
    apiModel,
    provider,
    calls,
    dryRun,
  };
}

type Provider = "anthropic" | "openai" | "gemini";

function inferProvider(model: Model): Provider | null {
  const p = model.provider.toLowerCase();
  if (p.includes("anthropic") || p.includes("claude")) return "anthropic";
  if (p.includes("openai")) return "openai";
  if (p.includes("google") || p.includes("gemini")) return "gemini";
  // Unmapped provider (DeepSeek, Moonshot, Alibaba, xAI, ...): return null so the
  // caller fails loudly instead of silently routing to the Anthropic endpoint.
  return null;
}

function envKey(provider: Provider): { name: string; value: string | undefined } {
  if (provider === "anthropic")
    return { name: "ANTHROPIC_API_KEY", value: process.env.ANTHROPIC_API_KEY };
  if (provider === "openai")
    return { name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY };
  return {
    name: "GOOGLE_API_KEY",
    value: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
  };
}

function zeroUsage(provider: Provider): Record<string, unknown> {
  if (provider === "anthropic")
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
  if (provider === "openai")
    return {
      prompt_tokens: 0,
      completion_tokens: 0,
      prompt_tokens_details: { cached_tokens: 0 },
    };
  return {
    usage_metadata: {
      prompt_token_count: 0,
      candidates_token_count: 0,
      cached_content_token_count: 0,
      thoughts_token_count: 0,
    },
  };
}

// Dry-run: synthesize an ActualCall whose prompt_tokens ~= countTokens(promptText)
// so the input diff is ~0. Uses the OpenAI usage shape regardless of target —
// evaluateReplay's actualTokenCounts + computeCallCost are provider-shape-tolerant.
// This is plumbing-only: the ~0 diff is by construction, NOT a measurement.
function synthesizeActuals(plan: ReplayPlan, target: Model): ActualCall[] {
  return plan.items.map((item) => {
    const cfInput =
      item.promptText.length > 0
        ? countTokens(item.promptText, target.id, target.provider).count
        : 0;
    const cfOutput = countTokens(
      item.completionText,
      target.id,
      target.provider,
    ).count;
    return {
      usage: {
        prompt_tokens: cfInput,
        completion_tokens: cfOutput,
        prompt_tokens_details: { cached_tokens: 0 },
      },
      billedCost: null,
    };
  });
}

async function callProvider(
  provider: Provider,
  key: string,
  apiModel: string,
  promptText: string,
): Promise<Record<string, unknown>> {
  if (provider === "anthropic") {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: apiModel,
        max_tokens: 1024,
        messages: [{ role: "user", content: promptText }],
      }),
    });
    const json = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error(
        `Anthropic API error ${resp.status}: ${JSON.stringify(json)}`,
      );
    }
    return (json.usage as Record<string, unknown> | undefined) ?? {};
  }
  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: "user", content: promptText }],
      }),
    });
    const json = (await resp.json()) as Record<string, unknown>;
    if (!resp.ok) {
      throw new Error(`OpenAI API error ${resp.status}: ${JSON.stringify(json)}`);
    }
    return (json.usage as Record<string, unknown> | undefined) ?? {};
  }
  // gemini
  // Security: pass the key via the x-goog-api-key header, NOT as a URL query
  // param (?key=...). Query strings are captured by proxy/access/crash logs and
  // process listings, which would leak the operator's Google API key. This
  // matches Google's documented auth and the Anthropic/OpenAI branches above.
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
      }),
    },
  );
  const json = (await resp.json()) as Record<string, unknown>;
  if (!resp.ok) {
    throw new Error(`Gemini API error ${resp.status}: ${JSON.stringify(json)}`);
  }
  return (json.usageMetadata as Record<string, unknown> | undefined) ?? {};
}

function fmtPct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(2)}%`;
}

function printEvaluation(ev: ReplayEvaluation): void {
  console.log("=== ReplayEvaluation ===");
  console.log(`sampleSize              : ${ev.sampleSize}`);
  console.log(`gateBasis               : ${ev.gateBasis}`);
  console.log(`method                  : ${ev.method}`);
  console.log(
    `inputTokenDiffMedianPct : ${fmtPct(ev.inputTokenDiffMedianPct)}`,
  );
  console.log(`inputTokenDiffP95Pct    : ${fmtPct(ev.inputTokenDiffP95Pct)}`);
  console.log(`costDiffMedianPct       : ${fmtPct(ev.costDiffMedianPct)}`);
  console.log(`costDiffP95Pct          : ${fmtPct(ev.costDiffP95Pct)}`);
  console.log(`passesPhase3            : ${ev.passesPhase3}`);
  if (ev.warnings.length) {
    console.log("warnings                :");
    ev.warnings.forEach((w) => console.log(`  - ${w}`));
  }
}

function printPairs(ev: ReplayEvaluation): void {
  console.log("\nper-call table:");
  console.log(
    "index | actualInput | cfInput | inputDiffPct | actualOutput | cfOutput | costDiffPct",
  );
  for (const p of ev.pairs) {
    const diff =
      p.inputTokenDiffPct === null
        ? "n/a"
        : `${(p.inputTokenDiffPct * 100).toFixed(2)}%`;
    console.log(
      `${String(p.index).padStart(5)} | ${String(p.actualInputTokens).padStart(11)} | ${String(p.counterfactualInputTokens ?? "-").padStart(7)} | ${diff.padStart(12)} | ${String(p.actualOutputTokens).padStart(12)} | ${String(p.counterfactualOutputTokens).padStart(8)} | ${(p.costDiffPct * 100).toFixed(2)}%`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const target = MODELS.find((m) => m.id === args.targetModelId);
  if (!target) {
    fail(
      `targetModelId '${args.targetModelId}' not found in MODELS. Known ids: ${MODELS.map((m) => m.id).join(", ")}`,
    );
  }
  const apiModel = args.apiModel ?? target.id;
  const provider = args.provider ?? "auto";

  // Resolve + validate provider ONCE here (before the --dry-run early-return) so
  // an unmapped provider (DeepSeek, Moonshot, Alibaba, ...) fails LOUDLY in both
  // modes instead of silently routing to the Anthropic endpoint with a foreign
  // model id. inferProvider returns null for unmapped providers. The explicit
  // --provider path (anthropic|openai|gemini) is unchanged; only "auto" infers.
  let resolvedProvider: Provider;
  if (provider === "auto") {
    const inferred = inferProvider(target);
    if (inferred === null) {
      fail(
        `unsupported provider "${target.provider}" for model ${target.id}; pass --provider anthropic|openai|gemini (or use a supported target)`,
      );
    }
    resolvedProvider = inferred;
  } else if (
    provider === "anthropic" ||
    provider === "openai" ||
    provider === "gemini"
  ) {
    resolvedProvider = provider;
  } else {
    fail(`--provider must be auto|anthropic|openai|gemini, got '${provider}'`);
  }

  let raw: string;
  try {
    raw = readFileSync(args.traceFile, "utf8");
  } catch (e) {
    fail(`could not read traceFile '${args.traceFile}': ${(e as Error).message}`);
  }
  let parsed: ReturnType<typeof parseTrace>;
  try {
    parsed = parseTrace(raw);
  } catch (e) {
    if (e instanceof TraceParseError) {
      fail(`parseTrace failed (code ${e.code}): ${e.message}`);
    }
    fail(`parseTrace failed: ${(e as Error).message}`);
  }
  if (!parsed.rawCalls || parsed.rawCalls.length === 0) {
    fail("parsed trace has no rawCalls; nothing to replay.");
  }

  const fullPlan = buildReplayPlan(parsed.rawCalls, target);
  const cap =
    args.calls && Number.isFinite(args.calls)
      ? Math.max(0, Math.floor(args.calls))
      : fullPlan.items.length;
  const items = fullPlan.items.slice(0, cap);
  const plan: ReplayPlan = { ...fullPlan, items };

  console.log(`traceFile      : ${args.traceFile}`);
  console.log(
    `targetModelId  : ${target.id} (${target.provider})`,
  );
  console.log(`apiModel       : ${apiModel}`);
  console.log(`provider       : ${provider}`);
  console.log(
    `plan items     : ${plan.items.length}${
      cap < fullPlan.items.length
        ? ` (capped from ${fullPlan.items.length} via --calls ${cap})`
        : ""
    }`,
  );
  console.log(`dryRun         : ${args.dryRun}`);
  if (fullPlan.warnings.length) {
    console.log("plan warnings  :");
    fullPlan.warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (plan.items.length < 20) {
    console.log(
      `NOTE: ${plan.items.length} item(s) < 20 — methodology §4.4 wants >=20 calls for a statistically meaningful gate.`,
    );
  }
  console.log("");

  if (args.dryRun) {
    console.log(
      "*** DRY RUN — no API calls made; actuals are SYNTHETIC (constructed to approximate",
    );
    console.log(
      "    the target tokenizer count); this proves the driver plumbing, NOT accuracy. ***\n",
    );
    const actuals = synthesizeActuals(plan, target);
    const ev = evaluateReplay(plan, actuals, target);
    printEvaluation(ev);
    printPairs(ev);
    console.log(
      "\nNext (REAL, makes PAID calls): set the provider's API key env var and re-run WITHOUT --dry-run.",
    );
    return;
  }

  // ── REAL mode (operator-run, makes PAID calls) ──
  // (provider already resolved + validated above, before the --dry-run early-return)
  const { name: keyName, value: keyValue } = envKey(resolvedProvider);
  if (!keyValue) {
    console.error(
      `Error: set ${keyName} to run real replays; use --dry-run to verify plumbing without a key.`,
    );
    process.exit(1);
  }

  console.log(
    `\nREAL mode: provider=${resolvedProvider}, apiModel=${apiModel}. Tools are OMITTED (methodology §2: replay omits tools).`,
  );
  console.log(
    "Per-call failures are recorded as zero-usage placeholders and noted below.\n",
  );

  // Filter to playable items (promptText !== ""); keep order aligned.
  const playable = plan.items.filter((it) => it.promptText !== "");
  const skippedResponseOnly = plan.items.length - playable.length;
  if (skippedResponseOnly > 0) {
    console.log(
      `Skipping ${skippedResponseOnly} response-only item(s) (no promptText captured).`,
    );
  }

  const actuals: ActualCall[] = [];
  let failed = 0;
  for (const item of playable) {
    try {
      const usage = await callProvider(
        resolvedProvider,
        keyValue,
        apiModel,
        item.promptText,
      );
      actuals.push({ usage, billedCost: null });
    } catch (e) {
      failed += 1;
      console.error(
        `item ${item.index}: API call failed — ${(e as Error).message} (recorded as zero-usage placeholder)`,
      );
      actuals.push({ usage: zeroUsage(resolvedProvider), billedCost: null });
    }
  }

  const realPlan: ReplayPlan = { ...plan, items: playable };
  const ev = evaluateReplay(realPlan, actuals, target);
  printEvaluation(ev);
  printPairs(ev);
  console.log(
    `\nCost note: real replays made ${playable.length - failed} paid API call(s) to ${resolvedProvider} (${failed} failed); check your dashboard.`,
  );
}

main().catch((e: unknown) => {
  console.error(`Unhandled error: ${(e as Error).message}`);
  process.exit(1);
});
