import Link from "next/link";

const TRACE_LAST_COMMIT = "c48c6ad64bda04d92db2c9915088e46e2efe0c2d";

export default function TraceRetiredPage() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-16">
      <div className="max-w-xl mx-auto space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Retired
        </p>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          Trace Analyzer has been removed
        </h1>
        <p className="text-sm text-stone-600 leading-relaxed">
          This app is now a single-page forward cost estimator. The Trace
          Analyzer, classifier, recommendation, retokenization, replay, and
          billed-cost reconstruction stack are no longer shipped.
        </p>
        <p className="text-sm text-stone-600 leading-relaxed">
          The last commit that still contains that implementation is{" "}
          <code className="text-stone-800">{TRACE_LAST_COMMIT.slice(0, 7)}</code>
          . Recover it from git history; it is not archived in this tree.
        </p>
        <p>
          <Link
            href="/"
            className="text-sm font-medium text-stone-800 underline underline-offset-2"
          >
            Back to the cost estimator
          </Link>
        </p>
      </div>
    </main>
  );
}
