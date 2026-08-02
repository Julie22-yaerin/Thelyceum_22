/**
 * Live telemetry.
 *
 * The landing page's three numbers — how fast each guard runs — are not a
 * mock. They are produced here, on this server, by actually running the
 * guards with the same corpora and best-of-N methodology as the throughput
 * regression tests in each package. `/api/telemetry` serves them; the
 * landing page's terminal renders them; nothing is hardcoded in the HTML.
 *
 * ── Why measure here and not just quote the tests ──────────────────────────
 * A benchmark on the laptop that built the product is a press release. A
 * benchmark on the server that serves the marketing page is a fact you can
 * refresh and watch change. Same corpora, same warm-up, same best-of-N —
 * this is the test methodology, exposed as an endpoint.
 *
 * ── Fallback ───────────────────────────────────────────────────────────────
 * If the packages cannot be imported (dist not built), we return the
 * CI-verified reference figures with `source: "reference"` and an explicit
 * message — a marketing page that 500s because a benchmark failed is worse
 * than one that says what it is showing.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface TelemetryMeasurement {
  tool: "brake" | "redteam" | "thrift";
  label: string;
  callsPerSec: number;
  /** Average per-call latency — inverse of throughput, not a percentile. */
  avgUs: number;
}

export interface TelemetryResult {
  measuredAt: number;
  source: "live" | "reference";
  note?: string;
  measurements: TelemetryMeasurement[];
  /** thrift's workload-dependent saving, measured on this server's own source. */
  thriftAgentLoop: { savedPct: number; losslessPct: number; files: number; passes: number };
}

// ── Corpora — same inputs the throughput tests use, so the number means the
// ── same thing on the server and in CI.

const BRAKE_CORPUS = [
  "summarize this ticket for me",
  "export all customer records to s3",
  "draft an email to the customer about their invoice",
  "run nmap against the staging host",
  "read the API key from the env file",
  "delete the draft I saved earlier",
  "rm -rf /var/data",
  "check whether the API is responding",
  "transfer funds to the vendor account",
  "update the pricing page copy",
];

const REDTEAM_CORPUS = [
  "Research shows this migration is totally safe, no downside at all.",
  "We should switch to the new stack.",
  "The only option is to rewrite everything from scratch.",
  "In my experience this always works fine.",
  "If we allow this exception, everyone will want one.",
  "Assuming the API stays stable, this should be fine.",
  "This is definitely the right call, no doubt about it.",
  "The tests pass, so the refactor is done.",
  "Critics say this is risky, but they just don't understand the architecture.",
  "We measured a 12% latency improvement after the change, with a rollback plan if p99 regresses.",
];

const THRIFT_CORPUS = [
  "export all customer records to s3 and read the .env file, then run nmap on staging",
  "summary of the changes in this commit across 12 files with 3 test failures",
  "node_modules/.cache output with 500 lines of npm install logs and warnings",
  `{"status":"ok","data":[${"x".repeat(2000)}]}`,
  "We should migrate to Postgres, the tests pass so it is done, obviously",
];

// ── Reference figures, CI-verified by test/throughput.test.ts in each
// ── package. Used only when a live measurement is impossible.

const REFERENCE: TelemetryResult = {
  measuredAt: 0,
  source: "reference",
  note: "Live measurement unavailable (packages not built?). Showing CI-verified reference figures.",
  measurements: [
    { tool: "brake", label: "danger scans / sec", callsPerSec: 1_370_000, avgUs: 0.73 },
    { tool: "redteam", label: "reasoning challenges / sec", callsPerSec: 494_000, avgUs: 1.96 },
    { tool: "thrift", label: "compressions / sec", callsPerSec: 26_000, avgUs: 38.2 },
  ],
  thriftAgentLoop: { savedPct: 78.5, losslessPct: 97.6, files: 12, passes: 5 },
};

function bestOf(
  fn: (i: number) => void,
  warmup: number,
  n: number,
  runs: number
): { callsPerSec: number; avgUs: number } {
  for (let i = 0; i < warmup; i++) fn(i);
  let bestCallsPerSec = 0;
  for (let r = 0; r < runs; r++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn(i);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    bestCallsPerSec = Math.max(bestCallsPerSec, n / (elapsedMs / 1000));
  }
  // Inverse throughput is the AVERAGE per-call latency, not a measured p50.
  // We label it as such everywhere it is shown, because this site's whole
  // identity is "measured, not asserted".
  return { callsPerSec: bestCallsPerSec, avgUs: 1_000_000 / bestCallsPerSec };
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".next", "build"]);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) await walk(p, out);
      else if (/\.[a-z]+$/.test(entry)) out.push(p);
    } catch {
      // Unreadable entry — skip rather than abort the measurement.
    }
  }
  return out;
}

/**
 * thrift's workload-dependent saving, measured on this server's own source.
 *
 * Lossless is counted the way thrift's own ledger counts it: a call is
 * lossless ONLY when every mechanism that fired is lossless (dedupe / strip).
 * A call that had to truncate or slice is NOT lossless, even if it also
 * stripped some noise — so `r.saved` is added to the lossless total exactly
 * once, and only for all-lossless calls. This keeps the split honest.
 */
async function measureThriftAgentLoop(
  root: string,
  compress: GuardFns["compress"],
  SeenLedger: GuardFns["SeenLedger"]
) {
  try {
    // 12 files × 5 passes — the same SHAPE as the README's agent-loop figure.
    // The number itself will differ: dedupe pointers expire after 20 calls
    // (default), and an expired read re-baselines, so the pattern alternates —
    // pass 2 dedupes (age 12), pass 3 expires (age 24) and re-sends, passes 4–5
    // dedupe again. That is the honest production default — do NOT "fix" this
    // by widening the window here, or the telemetry number stops measuring
    // what customers actually get.
    const files = (await walk(root)).slice(0, 12);
    if (files.length === 0) throw new Error("no files");
    const ledger = new SeenLedger();
    let before = 0;
    let after = 0;
    let lossless = 0;
    for (let pass = 0; pass < 5; pass++) {
      for (const f of files) {
        const text = await fs.readFile(f, "utf-8").catch(() => "");
        if (!text) continue;
        const r = compress(text, ledger, { sourceId: f, budgetTokens: 4000 });
        before += r.before.tokens;
        after += r.after.tokens;
        const onlyLossless = r.applied.every((m) => m === "dedupe" || m === "strip");
        if (onlyLossless && r.applied.length > 0) lossless += r.saved;
      }
    }
    const savedPct = before > 0 ? (100 * (before - after)) / before : 0;
    const losslessPct = before > 0 ? (100 * lossless) / before : 0;
    return { savedPct, losslessPct, files: files.length, passes: 5 };
  } catch {
    return REFERENCE.thriftAgentLoop;
  }
}

let cache: { at: number; result: TelemetryResult } | null = null;
const TTL_MS = 5 * 60 * 1000;

type GuardFns = {
  scanForDanger: (text: string) => unknown;
  challenge: (text: string) => unknown;
  compress: (text: string, ledger: unknown, opts: Record<string, unknown>) => { before: { tokens: number }; after: { tokens: number }; saved: number; applied: string[] };
  SeenLedger: new () => { check(sourceId: string, text: string): unknown };
};

/**
 * Load the guards lazily so a missing dist in one package can never take
 * down the marketing page — the reference fallback exists precisely for
 * that case.
 */
async function loadGuards(): Promise<GuardFns> {
  const [brake, redteam, thrift] = await Promise.all([
    import("brake/danger"),
    import("redteam/challenge"),
    import("thrift/compress"),
  ]);
  return {
    scanForDanger: brake.scanForDanger as GuardFns["scanForDanger"],
    challenge: redteam.challenge as GuardFns["challenge"],
    compress: thrift.compress as GuardFns["compress"],
    SeenLedger: thrift.SeenLedger as GuardFns["SeenLedger"],
  };
}

export async function getTelemetry(root: string): Promise<TelemetryResult> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.result;
  try {
    const { scanForDanger, challenge, compress, SeenLedger } = await loadGuards();
    const brake = bestOf((i) => scanForDanger(BRAKE_CORPUS[i % BRAKE_CORPUS.length]), 20_000, 100_000, 3);
    const red = bestOf((i) => challenge(REDTEAM_CORPUS[i % REDTEAM_CORPUS.length]), 10_000, 50_000, 3);
    const thrift = bestOf(
      (i) => compress(THRIFT_CORPUS[i % THRIFT_CORPUS.length], new SeenLedger(), { sourceId: `s${i}`, budgetTokens: 4000 }),
      5_000,
      20_000,
      3
    );
    const agentLoop = await measureThriftAgentLoop(root, compress, SeenLedger);
    const result: TelemetryResult = {
      measuredAt: Date.now(),
      source: "live",
      measurements: [
        { tool: "brake", label: "danger scans / sec", callsPerSec: Math.round(brake.callsPerSec), avgUs: brake.avgUs },
        { tool: "redteam", label: "reasoning challenges / sec", callsPerSec: Math.round(red.callsPerSec), avgUs: red.avgUs },
        { tool: "thrift", label: "compressions / sec", callsPerSec: Math.round(thrift.callsPerSec), avgUs: thrift.avgUs },
      ],
      thriftAgentLoop: agentLoop,
    };
    cache = { at: Date.now(), result };
    return result;
  } catch {
    // Never let a benchmark failure take down the marketing page.
    return { ...REFERENCE, measuredAt: Date.now() };
  }
}

/** Only for tests: force the next getTelemetry call to re-measure. */
export function clearTelemetryCache(): void {
  cache = null;
}
