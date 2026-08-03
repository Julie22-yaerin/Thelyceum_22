#!/usr/bin/env node
/**
 * The Lyceum — cloud benchmark.
 *
 * One script, run anywhere: locally, or on a GitHub Actions cloud runner
 * (see .github/workflows/throughput.yml, which runs this on ubuntu x64 AND
 * arm64 and uploads the results as an artifact + step summary).
 *
 * Why this exists next to the throughput TESTS: the tests assert floors
 * (200k / 100k / 8k) so a regression fails CI, but they don't print the
 * measured number. This script measures the same functions with the same
 * corpora and best-of-N methodology and REPORTS the actual figures — so a
 * "cloud number" is a measured fact, not a promise made on a laptop.
 *
 * Two passes:
 *   throughput — same methodology as the tests and /api/telemetry:
 *                warm-up → best of N timed runs over a mixed corpus → best
 *                calls/sec.
 *   latency    — per-call timing over N samples (default 20k, env
 *                BENCH_LATENCY_SAMPLES): p50/p95/p99/max. calls/sec hides the
 *                tail, and the TRIAL_PLAN release gate is a tail number —
 *                brake p95 ≤ 1000ms on both cloud architectures. thrift gets
 *                its own ms-level p95 gate (default 10ms, env
 *                BENCH_LATENCY_FLOOR_THRIFT_MS): measured p95 is ~155µs, so a
 *                shared 1000ms pathology gate would sit 6400× away and never
 *                fire — a tail gate that cannot discriminate is not a gate.
 *   mcp wire   — scripts/mcp-smoke.mjs --json: spawns each dist/mcp.js on
 *                stdio and measures the REAL wire path (initialize handshake
 *                per fresh spawn, tools/list round-trips on one connection),
 *                p50/p95/p99/max per server, gated at p95 ≤ 2000ms init /
 *                ≤ 250ms list (env BENCH_MCP_INIT_GATE_MS /
 *                BENCH_MCP_LIST_GATE_MS). The in-process passes can't see a
 *                serialization/pipe regression — this one can.
 *
 * Exit code: 0 if every measurement is above its CI floor AND every p95 is
 * under its latency gate AND the thrift token-guard edge cases hold (JWT
 * preserved, image/JSON handled safely), 1 otherwise. The floors and fixtures
 * are duplicated from the test files on purpose — they are the contract, and
 * the script must fail loudly when a runner breaks it.
 */

import { writeFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { readdirSync } from "node:fs";
import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch } from "node:os";
import { scanForDanger } from "brake/danger";
import { challenge } from "redteam/challenge";
import { compress, SeenLedger } from "thrift/compress";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Corpora — identical to test/throughput.test.ts in each package, so the
// ── cloud number means the same thing as the CI floor. ─────────────────────

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

// ── CI floors — the contract. Same values as the throughput tests. ─────────
const FLOORS = { brake: 200_000, redteam: 100_000, thrift: 8_000 };

// ── Latency gates. brake's 1000ms is the TRIAL_PLAN release gate (p95 ≤
// ── 1000ms on cloud x64+arm64). redteam keeps the 1000ms pathology gate:
// ── these are in-process pure functions, so a p95 over a second means a
// ── catastrophic regression (a ReDoS-shaped regex, a lock) — exactly the
// ── tail the calls/sec number hides. thrift gets its OWN ms-level gate:
// ── measured p95 is ~155µs, so a shared 1000ms gate would sit ~6400× away
// ── and could never fire. 10ms is ~64× headroom over the measured p95 —
// ── won't flake on a noisy runner, yet still catches a ms-scale regression
// ── (accidental sync I/O, an O(n²) pass, a lock) in the hot path.
// ── Overridable per environment: BENCH_LATENCY_FLOOR_THRIFT_MS. ───────────
const LATENCY_FLOORS_MS = { brake: 1000, redteam: 1000, thrift: 10 };
// Clamped the same way as LATENCY_SAMPLES: a garbage env must never become
// NaN and crash the script before artifacts are written.
const THRIFT_LATENCY_FLOOR_MS = Math.max(
  0.1,
  Number(process.env.BENCH_LATENCY_FLOOR_THRIFT_MS) || LATENCY_FLOORS_MS.thrift
);
// Clamped: a garbage env value must never turn into NaN and crash the script
// before artifacts are written — this script's whole job is to fail loudly
// WITH data, not die silently without it.
const LATENCY_SAMPLES = Math.max(1, Number(process.env.BENCH_LATENCY_SAMPLES) || 20_000);
const LATENCY_WARMUP = 2_000;

// ── MCP wire-latency pass — delegates to scripts/mcp-smoke.mjs --json, the
// ── same script the mcp-handshake CI job runs, so the benchmark measures the
// ── exact same wire path CI asserts. Gates live in mcp-smoke (init ≤ 2000ms,
// ── list ≤ 250ms, env-overridable); this script just merges the verdict.
const MCP_LATENCY_TIMEOUT_MS = Math.max(30_000, Number(process.env.BENCH_MCP_LATENCY_TIMEOUT_MS) || 120_000);

function mcpWireLatency() {
  const res = spawnSync(process.execPath, [join(ROOT, "scripts/mcp-smoke.mjs"), "--json"], {
    encoding: "utf-8",
    timeout: MCP_LATENCY_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  if (res.error) {
    return { servers: [], ok: false, error: res.error.message, exitCode: res.status };
  }
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return { servers: [], ok: false, error: "mcp-smoke --json did not emit valid JSON", exitCode: res.status };
  }
  return {
    servers: parsed.servers ?? [],
    ok: parsed.ok === true,
    error: null,
    exitCode: res.status,
  };
}

function bestOf(fn, warmup, n, runs) {
  for (let i = 0; i < warmup; i++) fn(i);
  let best = 0;
  for (let r = 0; r < runs; r++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < n; i++) fn(i);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    best = Math.max(best, n / (elapsedMs / 1000));
  }
  return best;
}

/** Nearest-rank percentile of a sorted ascending array. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * Per-call latency distribution over `samples` individual calls. Deliberately
 * NOT best-of: throughput best-of measures the steady-state peak, latency must
 * measure the raw distribution, tail included. Includes hrtime overhead per
 * call — that is the real per-call cost a caller pays, and the gates are
 * generous enough that it only matters if the tail genuinely explodes.
 *
 * fn receives the loop INDEX, exactly like bestOf — the caller's fn does its
 * own corpus indexing (fn(i) => tool(corpus[i % corpus.length])).
 */
function latencyStats(fn, samples, warmup) {
  for (let i = 0; i < warmup; i++) fn(i);
  const timings = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const start = process.hrtime.bigint();
    fn(i);
    timings[i] = Number(process.hrtime.bigint() - start) / 1e6; // ms
  }
  const sorted = Array.from(timings).sort((a, b) => a - b);
  return {
    samples,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

// ── thrift's workload-dependent saving, measured on this repo's own source
// ── (12 files × 5 passes — the same shape as the README's agent-loop row). ─
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".next", "build", "graphify-out"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    try {
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|js|jsx|json|md)$/.test(entry)) out.push(p);
    } catch {
      // unreadable — skip rather than abort
    }
  }
  return out;
}

// ── thrift's token-guard edge cases — same fixtures as test/compress.test.ts,
// ── run here so a cloud runner MEASURES them and VERIFIES the behavior, not
// ── just the speed. A guard regression must fail the job even when the
// ── throughput floors still hold: a JWT whose claims were stripped is a
// ── silent data loss no calls-per-second number would ever show. ────────────

function savedPct(r) {
  return r.before.tokens > 0 ? (100 * r.saved) / r.before.tokens : 0;
}

function thriftEdgeCases() {
  // Any fixture problem must fail the RUN, not crash it before artifacts are
  // written — a job failure with no recorded numbers tells the operator
  // nothing. Report the cause and let the caller fail with the data intact.
  try {
    // JWT: header.payload.signature, standard base64 per segment. The payload
    // segment alone is ≥200 chars — a naive strip would eat it. The guard must
    // keep the token verbatim AND leave the claims decodable.
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
    const claims = {
      sub: "user-1042",
      role: "admin",
      exp: 1_900_000_000,
      scope: ["read", "write", "deploy", "build", "release", "audit"],
      permissions: ["iam.admin", "billing.write", "secrets.read", "infra.deploy", "audit.view"],
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64");
    if (payload.length < 200) {
      throw new Error("JWT payload segment must be ≥200 chars to trip the rule");
    }
    const token = `${header}.${payload}.${Buffer.from("signature").toString("base64")}`;

    const jwt = compress(token, new SeenLedger(), { sourceId: "edge-jwt" });
    const jwtKept = jwt.text.includes(token);
    let jwtDecoded = false;
    try {
      const seg = jwt.text.split(".")[1];
      jwtDecoded = JSON.parse(Buffer.from(seg, "base64").toString("utf-8")).role === "admin";
    } catch {
      // guard already failed — jwtDecoded stays false
    }

    // Image data URI: the pixel payload is stripped, but the MIME prefix and
    // the length marker must survive so the model can tell an image was there.
    const uri = `data:image/png;base64,${"A".repeat(3000)}`;
    const img = compress(uri, new SeenLedger(), { sourceId: "edge-img" });
    const imgHeld =
      img.text.includes("data:image/png;base64,") && /3000-char base64 omitted/.test(img.text);

    // Response JSON: the base64 value inside becomes a marker, but the
    // structure must stay parseable with the surrounding facts intact.
    const json = JSON.stringify({ status: "ok", code: 200, requestId: "req_ab12", data: "A".repeat(3000) });
    const resp = compress(json, new SeenLedger(), { sourceId: "edge-json" });
    let jsonHeld = false;
    try {
      const parsed = JSON.parse(resp.text);
      jsonHeld = parsed.status === "ok" && parsed.code === 200 && /base64 omitted/.test(parsed.data);
    } catch {
      // guard already failed — jsonHeld stays false
    }

    return {
      jwt: { savedPct: savedPct(jwt), held: jwtKept && jwtDecoded },
      image: { savedPct: savedPct(img), held: imgHeld },
      json: { savedPct: savedPct(resp), held: jsonHeld },
      allHeld: jwtKept && jwtDecoded && imgHeld && jsonHeld,
      error: null,
    };
  } catch (err) {
    return {
      jwt: { savedPct: 0, held: false },
      image: { savedPct: 0, held: false },
      json: { savedPct: 0, held: false },
      allHeld: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function thriftAgentLoop() {
  try {
    const files = walk(ROOT).slice(0, 12);
    if (files.length === 0) throw new Error("no files");
    const ledger = new SeenLedger();
    let before = 0, after = 0, lossless = 0;
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
    return {
      savedPct: before > 0 ? (100 * (before - after)) / before : 0,
      losslessPct: before > 0 ? (100 * lossless) / before : 0,
      files: files.length,
      passes: 5,
    };
  } catch {
    return { savedPct: 0, losslessPct: 0, files: 0, passes: 5 };
  }
}

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

/** Format a per-call latency: ns for sub-µs, µs for sub-ms, ms after that. */
function fmtMs(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  return `${ms.toFixed(2)}ms`;
}

const measurements = [
  {
    tool: "brake",
    label: "danger scans / sec",
    callsPerSec: 0,
    avgUs: 0,
    floor: FLOORS.brake,
    latency: null,
    latencyFloorMs: LATENCY_FLOORS_MS.brake,
  },
  {
    tool: "redteam",
    label: "reasoning challenges / sec",
    callsPerSec: 0,
    avgUs: 0,
    floor: FLOORS.redteam,
    latency: null,
    latencyFloorMs: LATENCY_FLOORS_MS.redteam,
  },
  {
    tool: "thrift",
    label: "compressions / sec",
    callsPerSec: 0,
    avgUs: 0,
    floor: FLOORS.thrift,
    latency: null,
    latencyFloorMs: THRIFT_LATENCY_FLOOR_MS,
  },
];

measurements[0].callsPerSec = Math.round(
  bestOf((i) => scanForDanger(BRAKE_CORPUS[i % BRAKE_CORPUS.length]), 20_000, 200_000, 5)
);
measurements[1].callsPerSec = Math.round(
  bestOf((i) => challenge(REDTEAM_CORPUS[i % REDTEAM_CORPUS.length]), 10_000, 100_000, 5)
);
measurements[2].callsPerSec = Math.round(
  bestOf(
    (i) => compress(THRIFT_CORPUS[i % THRIFT_CORPUS.length], new SeenLedger(), { sourceId: `s${i}`, budgetTokens: 4000 }),
    5_000,
    50_000,
    3
  )
);
for (const m of measurements) m.avgUs = 1_000_000 / m.callsPerSec;

// Latency pass — same corpora, each call timed individually.
measurements[0].latency = latencyStats(
  (i) => scanForDanger(BRAKE_CORPUS[i % BRAKE_CORPUS.length]),
  LATENCY_SAMPLES,
  LATENCY_WARMUP
);
measurements[1].latency = latencyStats(
  (i) => challenge(REDTEAM_CORPUS[i % REDTEAM_CORPUS.length]),
  LATENCY_SAMPLES,
  LATENCY_WARMUP
);
measurements[2].latency = latencyStats(
  (i) => compress(THRIFT_CORPUS[i % THRIFT_CORPUS.length], new SeenLedger(), { sourceId: `s${i}`, budgetTokens: 4000 }),
  LATENCY_SAMPLES,
  LATENCY_WARMUP
);

const agentLoop = await thriftAgentLoop();
const edge = thriftEdgeCases();
const mcpLatency = mcpWireLatency();
const allAboveFloor = measurements.every((m) => m.callsPerSec >= m.floor);
const latencyOk = measurements.every((m) => m.latency.p95Ms <= m.latencyFloorMs);
const mcpOk = mcpLatency.ok && mcpLatency.servers.every((s) => s.ok);
const ok = allAboveFloor && latencyOk && edge.allHeld && mcpOk;

const cpu = cpus()[0];
const machine = {
  os: `${platform()} (${arch})`,
  cpu: cpu?.model ?? "unknown",
  cores: cpus().length,
  node: process.version,
  generatedAt: Date.now(),
};

const result = {
  machine,
  measurements,
  thriftAgentLoop: agentLoop,
  thriftEdgeCases: edge,
  mcpLatency,
  // kept for artifact consumers that read the pre-edge-case field name
  allAboveFloor,
  latencyOk,
  mcpOk,
  ok,
};

// ── Human table ────────────────────────────────────────────────────────────
console.log(`Lyceum benchmark — ${machine.os} · ${machine.cpu} · ${machine.cores} cores · ${machine.node}`);
console.log(`measured ${new Date(machine.generatedAt).toISOString()}\n`);
console.log("  tool    calls/sec    avg/call   floor     status");
for (const m of measurements) {
  const pass = m.callsPerSec >= m.floor;
  console.log(
    `  ${m.tool.padEnd(8)}${fmt(m.callsPerSec).padStart(8)}  ${m.avgUs.toFixed(2).padStart(7)}µs  ${fmt(m.floor).padStart(7)}  ${pass ? "PASS" : "FAIL"}`
  );
}
console.log("\n  latency (per-call, N samples)");
console.log("  tool    p50         p95         p99         max         gate        status");
for (const m of measurements) {
  const pass = m.latency.p95Ms <= m.latencyFloorMs;
  console.log(
    `  ${m.tool.padEnd(8)}${fmtMs(m.latency.p50Ms).padStart(9)}  ${fmtMs(m.latency.p95Ms).padStart(9)}  ${fmtMs(m.latency.p99Ms).padStart(9)}  ${fmtMs(m.latency.maxMs).padStart(9)}  ${fmtMs(m.latencyFloorMs).padStart(9)}  ${pass ? "PASS" : "FAIL"}`
  );
}
console.log(
  `\n  thrift agent loop (${agentLoop.files} files × ${agentLoop.passes} passes): ` +
    `${agentLoop.savedPct.toFixed(1)}% saved, ${agentLoop.losslessPct.toFixed(1)}% of it lossless`
);
console.log(
  `  thrift token-guard edge cases: JWT ${edge.jwt.savedPct.toFixed(1)}% saved ${edge.jwt.held ? "✓ held" : "✗ BROKEN"} · ` +
    `image ${edge.image.savedPct.toFixed(1)}% ${edge.image.held ? "✓" : "✗ BROKEN"} · ` +
    `json ${edge.json.savedPct.toFixed(1)}% ${edge.json.held ? "✓" : "✗ BROKEN"}` +
    (edge.error ? ` · edge-case error: ${edge.error}` : "")
);
console.log("\n  MCP wire latency (initialize → tools/list over stdio)");
console.log("  server  init p50     init p95     init p99     list p50     list p95     list p99     init gate   list gate   status");
if (mcpLatency.error) {
  console.log(`  ✗ mcp-smoke --json: ${mcpLatency.error}`);
} else if (mcpLatency.servers.length === 0) {
  console.log("  (no MCP servers measured)");
} else {
  for (const s of mcpLatency.servers) {
    if (!s.initialize || !s.listTools) {
      console.log(`  ✗ ${s.name}: incomplete latency data`);
      continue;
    }
    console.log(
      `  ${s.name.padEnd(8)}${fmtMs(s.initialize.p50Ms).padStart(9)}  ${fmtMs(s.initialize.p95Ms).padStart(9)}  ${fmtMs(s.initialize.p99Ms).padStart(9)}  ${fmtMs(s.listTools.p50Ms).padStart(9)}  ${fmtMs(s.listTools.p95Ms).padStart(9)}  ${fmtMs(s.listTools.p99Ms).padStart(9)}  ${fmtMs(s.initialize.gateMs).padStart(9)}  ${fmtMs(s.listTools.gateMs).padStart(9)}  ${s.ok ? "PASS" : "FAIL"}`
    );
  }
}
const failReasons = [];
if (!allAboveFloor) failReasons.push("throughput below floor");
if (!edge.allHeld) failReasons.push("token-guard edge case broken" + (edge.error ? ` (${edge.error})` : ""));
if (!latencyOk) failReasons.push("p95 latency above gate");
if (!mcpOk) failReasons.push("MCP wire latency above gate" + (mcpLatency.error ? ` (${mcpLatency.error})` : ""));
console.log(
  failReasons.length === 0
    ? "\nAll measurements above CI floor; token-guard edge cases hold; every p95 under its latency gate; MCP wire latency under its gates."
    : `\nFAIL: ${failReasons.join("; ")}.`
);
console.log(`\nJSON report: benchmark-results.json`);
console.log(`Markdown summary: benchmark-summary.md`);

// ── Machine-readable JSON ──────────────────────────────────────────────────
writeFileSync(join(ROOT, "benchmark-results.json"), JSON.stringify(result, null, 2) + "\n");

// ── Markdown summary for $GITHUB_STEP_SUMMARY ──────────────────────────────
const rows = measurements
  .map(
    (m) =>
      `| ${m.tool} | ${fmt(m.callsPerSec)} calls/sec | ${m.avgUs.toFixed(2)}µs | ${m.callsPerSec >= m.floor ? "✅" : "❌"} |`
  )
  .join("\n");
const latencyRows = measurements
  .map(
    (m) =>
      `| ${m.tool} | ${fmtMs(m.latency.p50Ms)} | ${fmtMs(m.latency.p95Ms)} | ≤ ${fmtMs(m.latencyFloorMs)} | ${m.latency.p95Ms <= m.latencyFloorMs ? "✅" : "❌"} |`
  )
  .join("\n");
const mcpRows =
  mcpLatency.servers.length === 0
    ? `| MCP wire | — | — | — | ${mcpLatency.error ? "❌ " + mcpLatency.error : "no data"} |`
    : mcpLatency.servers
        .map((s) => {
          if (!s.initialize || !s.listTools) return `| MCP ${s.name} | — | — | — | ❌ incomplete data |`;
          return `| MCP ${s.name} | init ${fmtMs(s.initialize.p95Ms)} | list ${fmtMs(s.listTools.p95Ms)} | ≤ ${fmtMs(s.initialize.gateMs)} init / ≤ ${fmtMs(s.listTools.gateMs)} list | ${s.ok ? "✅" : "❌"} |`;
        })
        .join("\n");
const md = `## Lyceum throughput benchmark — ${machine.os}

**Host:** ${machine.cpu} · ${machine.cores} cores · ${machine.node}
**Measured:** ${new Date(machine.generatedAt).toISOString()}

| Tool | Throughput | Avg / call | Above floor? |
|---|---|---|---|
${rows}

**Latency (per-call, ${LATENCY_SAMPLES} samples):**

| Tool | p50 | p95 | Gate (p95) | Under gate? |
|---|---|---|---|---|
${latencyRows}

**MCP wire latency (initialize → tools/list over stdio):**

| Server | Init p95 | List p95 | Gates | Under gates? |
|---|---|---|---|---|
${mcpRows}
| thrift agent loop | ${agentLoop.savedPct.toFixed(1)}% saved | ${agentLoop.losslessPct.toFixed(1)}% lossless | ${agentLoop.files} files × ${agentLoop.passes} passes |
| thrift edge: JWT | ${edge.jwt.savedPct.toFixed(1)}% saved (0% is correct — claims are facts) | claims decodable | ${edge.jwt.held ? "✅" : "❌"} |
| thrift edge: image URI | ${edge.image.savedPct.toFixed(1)}% saved | MIME prefix + length kept | ${edge.image.held ? "✅" : "❌"} |
| thrift edge: response JSON | ${edge.json.savedPct.toFixed(1)}% saved | still parseable, facts intact | ${edge.json.held ? "✅" : "❌"} |

${ok ? "✅ All measurements above CI floor; token-guard edge cases hold; every p95 under its latency gate; MCP wire latency under its gates." : "❌ " + failReasons.join(" ") + "."}
`;
writeFileSync(join(ROOT, "benchmark-summary.md"), md);

process.exit(ok ? 0 : 1);
