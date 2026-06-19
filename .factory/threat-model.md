# Threat Model — agent-cost-calc

**Version:** 1.0.0
**Generated:** 2026-06-19
**Stack:** Next.js 16 (static export) + React 19 + Tailwind, zero backend.

## 1. System Overview

`agent-cost-calc` is a single-page, fully client-side cost estimator for AI
agent workloads. All computation runs in the browser; there is no server, no
database, no authentication, and no persistent user storage.

### Components

| Component | Location | Runs where | Trust zone |
|---|---|---|---|
| Static page shell | `src/app/page.tsx`, `layout.tsx` | Vercel edge (static HTML) | Public (immutable) |
| Cost math | `src/lib/models.ts`, `counterfactual.ts`, `recommend.ts` | Browser | Public |
| Task classifier | `src/lib/classifyTask.ts` | Browser | Public |
| Trace parser | `src/lib/parseTrace.ts` | Browser (and Node test runner) | Public |
| Re-tokenizer | `src/lib/tokenize.ts`, `retokenize.ts`, `retokenizedCost.ts` | Browser | Public |
| Replay harness | `src/lib/replayHarness.ts`, `reconstructCost.ts` | Browser (and Node CLI) | Public |
| Operator scripts | `scripts/*.ts` (tsx-run CLIs) | Local developer machine only | Internal |
| Fixtures | `fixtures/*.json`, `*.jsonl` | Bundled/test-only | Internal |

### Data flows

1. **User inputs token/config numbers** in form fields → in-memory React state → `calculateCost()` → rendered table. Nothing leaves the browser.
2. **Operator (dev) runs trace replay**: reads a local JSON/JSONL trace file from disk via `scripts/replay-driver.ts` → `parseTrace()` → cost layer → stdout. Filesystem read only; no network.
3. **Build time**: Next.js prerenders `/` to static HTML. No server runtime.

### Trust boundaries

- **Public zone**: the deployed static site. Inputs are user-controlled but never persisted, executed, or reflected unsanitized.
- **Internal zone**: the developer machine running `npm run replay` / `npm run validate-counterfactual`. Inputs are local files the operator chose.

There is no authenticated zone.

## 2. Critical Assets

| Asset | Sensitivity | Storage | Notes |
|---|---|---|---|
| Model pricing data | Public | Hardcoded in `models.ts` | Already published in README |
| `fixtures/real-*.json[l]` | Low | Repo | Synthetic example traces (verified no PII/keys) |
| Operator's real trace files | Operator-controlled | Not in repo | Out of scope — operator's own machine |
| Vercel project link (`.vercel/`) | Low | gitignored | Project/org IDs only; no secrets |

**No PII, credentials, API keys, or customer data are stored, transmitted, or
processed by this application.** The README and fixtures were scanned for
secrets on 2026-06-19; none found.

## 3. Attack Surface

Minimal. Externally reachable surface is a single static HTML document.

- No HTTP endpoints accepting user input.
- No file upload to the server (only the operator CLI reads local files, locally).
- No auth/session/cookies.
- No third-party API calls from the deployed site.
- No `dangerouslySetInnerHTML`, `eval`, or dynamic code execution in the client.

## 4. STRIDE Analysis

### S — Spoofing
**Not applicable.** No identity, no auth, no impersonatable principals.

### T — Tampering
- **XSS via trace text rendering (MEDIUM likelihood, LOW impact).** If a future
  feature renders `completionText` from a parsed trace into the DOM, any HTML
  inside the trace would execute. Today the app renders form inputs and computed
  numbers, not raw trace text, so the risk is latent. Mitigation: React escapes
  by default; never introduce `dangerouslySetInnerHTML` over trace content.
- **Prototype pollution via `JSON.parse` on operator trace files (LOW).**
  `parseTrace.ts` parses operator-supplied JSON. Parsed objects are only read
  (field access), never passed to constructors or merged into prototypes, so
  pollution does not escalate. Mitigation: keep parse output read-only.
- **ReDoS in any future regex over trace text (LOW).** Current regexes in
  `parseTrace.ts` are bounded and run on small operator traces, not untrusted
  internet input.

### R — Repudiation
**Not applicable.** No audit-relevant actions, no accounts, no commitments.

### I — Information Disclosure
- **Verbose error messages (LOW).** `TraceParseError` surfaces the failure reason
  to the operator console. Acceptable: operator-only audience, no secrets in
  traces.
- **Source map exposure (LOW).** Production build ships source maps. These
  expose source code (already public) but no secrets. Acceptable for an open
  repo.

### D — Denial of Service
- **Client-side compute cost (LOW).** `countTokens` runs a real BPE tokenizer
  over arbitrary text. A pathologically large trace pasted by a user could
  freeze the tab. Impact is limited to that one user's browser. Mitigation:
  guard against multi-MB inputs if trace paste is ever added to the UI.

### E — Elevation of Privilege
**Not applicable.** No privilege levels exist.

## 5. Vulnerability Pattern Library

### React/Next.js — safe-by-default, latent risks
```tsx
// SAFE — React escapes text interpolation
<p>{trace.completionText}</p>

// VULNERABLE — never introduce this for trace content
<div dangerouslySetInnerHTML={{ __html: trace.completionText }} />
```

### JSON parsing of operator-supplied traces
```ts
// CURRENT — read-only field access after parse; no escalation path
const parsed = JSON.parse(raw);
const usage = parsed.message?.usage; // field access only

// AVOID — never merge parsed input into prototypes or constructors
Object.assign(someObject, JSON.parse(raw));
```

### Regex over trace text (ReDoS latent)
```ts
// CURRENT — bounded patterns, operator traces only
/if\s*\([\s\S]*?\)/i

// AVOID — unbounded backtracking over internet-supplied input
/(a+)+$/
```

### File access in operator CLIs
```ts
// CURRENT — operator-supplied local path, no network
const raw = readFileSync(operatorChosenPath, "utf8");

// AVOID — never derive paths from untrusted input or fetch over network
fetch(userUrl).then((r) => r.text());
```

## 6. Security Testing Strategy

1. **Dependency audit gate.** `npm audit` must report 0 vulnerabilities before
   deploy. Enforced via the `overrides` block in `package.json`.
2. **Secret scan in CI** (recommended addition). Run `gitleaks` or equivalent on
   every push to catch accidental key commits.
3. **No `dangerouslySetInnerHTML` lint rule** (recommended addition). Add an
   ESLint rule forbidding it across `src/`.
4. **Manual review checkpoint** for any PR that (a) adds a `fetch()` call,
   (b) adds `dangerouslySetInnerHTML`, (c) adds a server route, or
   (d) reads a path from URL/query input.

## 7. Assumptions & Accepted Risks

- The deployed site never calls third-party APIs from the browser. Any future
  feature that does (e.g. live tokenizer API) must re-run threat modeling.
- Operator CLIs run on trusted developer machines; trace files are assumed
  non-adversarial.
- Production deploys are currently **disabled** via `vercel.json` pending
  security review completion.

## 8. Changelog

- **1.0.0 (2026-06-19):** Initial generation. Established baseline for a
  zero-backend static Next.js app; production deploys halted pending review.
- **1.0.1 (2026-06-19):** Re-scan after fixes. VULN-001 (Gemini key in URL,
  scripts/replay-driver.ts) and VULN-002 (tokenizer DoS, src/lib/tokenize.ts)
  both resolved. npm audit: 0 vulnerabilities. Production deploy block lifted.
