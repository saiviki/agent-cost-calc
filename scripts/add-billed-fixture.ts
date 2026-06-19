// Operator tooling — Script A (docs/RUNBOOK-billed-accuracy.md §3 shortcut).
// One-command wiring of a REAL trace + the operator's REAL per-run billed cost
// into the ±5% billed-accuracy gate. This is a MECHANISM only: it takes the
// operator's real invoice value as an ARGUMENT and wires it — it does NOT
// fabricate billed data (P4). The empirical ±5% claim still requires ≥3 diverse
// real traces + real invoices (methodology §4.1).
//
// Usage:
//   npx tsx scripts/add-billed-fixture.ts <traceFile> <billedPerRun> [modelId] [--dry-run] [--note "..."]
//   npm run add-fixture -- <traceFile> <billedPerRun> [modelId] [--dry-run] [--note "..."]
//
// <billedPerRun> is the operator's REAL per-run invoice $ (the gate multiplies it
// by the trace's run count). --dry-run prints the would-be expected.json patch +
// the it() block WITHOUT writing.
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTrace, TraceParseError } from "../src/lib/parseTrace";
import { reconstructCost } from "../src/lib/reconstructCost";
import { MODELS, type Model } from "../src/lib/models";
import { runBilledGate } from "../src/lib/__tests__/billedGate.helper";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const FIXTURES_DIR = join(PROJECT_ROOT, "fixtures");

type Args = {
  traceFile: string;
  billedPerRun: number;
  modelId?: string;
  dryRun: boolean;
  note?: string;
};

function fail(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

// Robust same-file check via inode+device. Handles relative paths, symlinks, and
// the not-yet-existing target. Used by the self-copy guard so the operator's
// trace data is never clobbered by copyFileSync(src, dst) on the same file —
// safety must NOT rely on libuv's implicit same-inode detection.
function isSameFile(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    // target doesn't exist yet, or stat failed -> not the same file -> safe to copy
    return false;
  }
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let dryRun = false;
  let note: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--note") {
      note = argv[++i];
      continue;
    }
    if (a.startsWith("--note=")) {
      note = a.slice("--note=".length);
      continue;
    }
    positional.push(a);
  }
  if (positional.length < 2) {
    console.error(
      "Usage: npx tsx scripts/add-billed-fixture.ts <traceFile> <billedPerRun> [modelId] [--dry-run] [--note \"...\"]",
    );
    process.exit(1);
  }
  const traceFile = positional[0];
  const billedPerRun = Number(positional[1]);
  if (!Number.isFinite(billedPerRun) || billedPerRun < 0) {
    fail(`<billedPerRun> must be a non-negative number, got '${positional[1]}'.`);
  }
  return { traceFile, billedPerRun, modelId: positional[2], dryRun, note };
}

function resolveModel(parsed: ParsedLike, modelId?: string): Model {
  if (modelId) {
    const m = MODELS.find((x) => x.id === modelId);
    if (!m) {
      fail(
        `modelId '${modelId}' not found in MODELS. Known ids: ${MODELS.map((x) => x.id).join(", ")}`,
      );
    }
    return m;
  }
  if (parsed.sourceModel) {
    const src = parsed.sourceModel;
    const m = MODELS.find((x) => src === x.id || src.includes(x.id));
    if (m) return m;
    fail(
      `could not resolve model from sourceModel '${src}'; pass [modelId] explicitly. Known ids: ${MODELS.map(
        (x) => x.id,
      ).join(", ")}`,
    );
  }
  fail(
    `trace has no sourceModel and no [modelId] given; pass [modelId] explicitly. Known ids: ${MODELS.map(
      (x) => x.id,
    ).join(", ")}`,
  );
}

type ParsedLike = {
  runs: number;
  sourceModel?: string;
  rawCalls?: unknown[];
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // 1–2. Read + parse the trace.
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
    fail(
      "parsed trace has no rawCalls (no qualifying usage captured). Cannot wire a billed gate without raw_usage ground truth.",
    );
  }

  // 3. Resolve the model.
  const model = resolveModel(parsed as ParsedLike, args.modelId);

  const fixtureName = basename(args.traceFile);
  const targetPath = join(FIXTURES_DIR, fixtureName);

  console.log(`traceFile    : ${args.traceFile}`);
  console.log(`fixtureName  : ${fixtureName}`);
  console.log(`runs         : ${parsed.runs}`);
  console.log(`sourceModel  : ${parsed.sourceModel ?? "(none)"}`);
  console.log(`resolved     : ${model.id} (${model.provider})`);
  console.log(
    `billedPerRun : $${args.billedPerRun}  (operator's REAL invoice value, PER RUN)`,
  );
  console.log(
    `billedTotal  : $${(args.billedPerRun * parsed.runs).toFixed(6)}  (= billedPerRun × ${parsed.runs} runs)`,
  );
  console.log(`dryRun       : ${args.dryRun}`);
  console.log("");

  // 4. Copy the trace into fixtures/ (skip in --dry-run).
  if (args.dryRun) {
    console.log(`[dry-run] would copy ${args.traceFile} -> ${targetPath}`);
  } else if (isSameFile(args.traceFile, targetPath)) {
    console.log(`trace already at ${targetPath} (no copy needed)`);
  } else {
    copyFileSync(args.traceFile, targetPath);
    console.log(`copied trace -> ${targetPath}`);
  }

  // 5. Update fixtures/expected.json (preserve _note / _reconstructed_note).
  const expectedPath = join(FIXTURES_DIR, "expected.json");
  const expected = JSON.parse(
    readFileSync(expectedPath, "utf8"),
  ) as Record<string, unknown>;

  let expectedReconstructedCost: number | undefined;
  try {
    const rec = reconstructCost({
      rawCalls: parsed.rawCalls,
      model,
    });
    expectedReconstructedCost = Number(rec.totalComputed.toFixed(6));
  } catch {
    expectedReconstructedCost = undefined;
  }

  const entry: Record<string, unknown> = {
    expectedSourceModel: model.id,
    expectedRuns: parsed.runs,
    billedCostPerRun: args.billedPerRun,
  };
  if (expectedReconstructedCost !== undefined) {
    entry.expectedReconstructedCost = expectedReconstructedCost;
  }
  if (args.note !== undefined) {
    entry.note = args.note;
  }

  if (args.dryRun) {
    console.log(
      `\n[dry-run] would-be expected.json entry for key '${fixtureName}' (NOT written):`,
    );
    console.log(JSON.stringify({ [fixtureName]: entry }, null, 2));
  } else {
    const updated = { ...expected, [fixtureName]: entry };
    writeFileSync(expectedPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    console.log(`updated ${expectedPath}  (entry '${fixtureName}')`);
  }

  // 6. Print the it() block to paste into parseTrace.test.ts.
  console.log(
    "\n--- paste into src/lib/__tests__/parseTrace.test.ts ---",
  );
  console.log(
    'import { runBilledGate } from "./billedGate.helper";  // add once near the top, if not already present',
  );
  console.log(`it("${fixtureName} within ±5% of invoice", () => {`);
  console.log(`  const g = runBilledGate("${fixtureName}");`);
  console.log("  expect(g.hasRealInvoice).toBe(true); // guards against a null bill");
  console.log("  expect(g.passesHard).toBe(true); // |computed - billed|/billed <= 5%");
  console.log("});");
  console.log("--- end ---\n");

  // 7. Run the gate for instant feedback.
  if (args.dryRun) {
    const rec = reconstructCost({ rawCalls: parsed.rawCalls, model });
    console.log(
      `[dry-run] computedCost (reconstructCost total): $${rec.totalComputed.toFixed(
        6,
      )}  — expected.json NOT written, so runBilledGate skipped (it would read null billed).`,
    );
  } else {
    // expected.json was just written; runBilledGate's lazy expected() cache reads
    // it fresh on first call (no stale read happened above via the helper).
    const g = runBilledGate(fixtureName);
    const fmtPct = (v: number | null): string =>
      v === null ? "n/a" : `${(v * 100).toFixed(2)}%`;
    console.log("=== runBilledGate result ===");
    console.log(`fixtureName        : ${g.fixtureName}`);
    console.log(`provider           : ${g.provider}`);
    console.log(`sourceModelId      : ${g.sourceModelId ?? "(unresolved)"}`);
    console.log(`runs               : ${g.runs}`);
    console.log(
      `computedCost       : ${Number.isFinite(g.computedCost) ? `$${g.computedCost.toFixed(6)}` : "n/a"}`,
    );
    console.log(
      `billedCost (total) : ${g.billedCost !== null ? `$${g.billedCost.toFixed(6)}` : "n/a"}`,
    );
    console.log(`errorPct           : ${fmtPct(g.errorPct)}`);
    console.log(`passesTarget (<=2%): ${g.passesTarget}`);
    console.log(`passesHard   (<=5%): ${g.passesHard}`);
    if (g.warnings.length) {
      console.log("warnings           :");
      g.warnings.forEach((w) => console.log(`  - ${w}`));
    }
  }

  // 8. Final one-liner.
  console.log(
    "\nNext: paste the it() block into parseTrace.test.ts and run npm test.",
  );
}

main();
