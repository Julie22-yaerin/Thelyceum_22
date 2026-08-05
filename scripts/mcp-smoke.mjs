#!/usr/bin/env node
/**
 * The Lyceum — MCP handshake smoke (TRIAL_PLAN.md cloud track).
 *
 * Runs on cloud runners (see .github/workflows/throughput.yml, job
 * `mcp-handshake`, x64 + arm64). An MCP server that starts but never speaks
 * to a host is untested until a human finds out; this job is the host.
 *
 * Per package:
 *   spawn <pkg>/dist/mcp.js on stdio
 *   client.connect() → performs the `initialize` handshake
 *   assert server identity (name + version) from the initialize response
 *   client.listTools() → assert every expected tool is advertised
 *
 * Uses the same @modelcontextprotocol/sdk Client the packages ship, so the
 * wire protocol is exercised for real — not a re-implementation of it.
 *
 * Two modes:
 *   default — handshake smoke: spawn → initialize → identity → tools/list
 *             assertion. Exit 0 when all three servers pass, 1 otherwise.
 *   --json  — wire-latency pass: for each server, MCP_INIT_SAMPLES fresh
 *             spawn+initialize timings (p50/p95/p99/max) and MCP_LIST_SAMPLES
 *             tools/list round-trips on one live connection. Emits a single
 *             JSON document on stdout (diagnostics on stderr) with per-server
 *             initialize/listTools latency stats, gated at p95 ≤
 *             BENCH_MCP_INIT_GATE_MS (default 2000) / BENCH_MCP_LIST_GATE_MS
 *             (default 250). scripts/benchmark.mjs spawns this and merges the
 *             numbers into benchmark-results.json.
 *
 * Local run (after `npm run build`):
 *   node scripts/mcp-smoke.mjs
 *   node scripts/mcp-smoke.mjs --json
 *
 * Exit code: 0 when all three servers pass, 1 otherwise (either mode).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HANDSHAKE_TIMEOUT_MS = 30_000;

// ── Wire-latency pass (--json) tuning. All env-overridable and clamped: a
// ── garbage env value must never become NaN and crash the pass mid-run. ────
const MCP_INIT_SAMPLES = Math.max(1, Number(process.env.MCP_INIT_SAMPLES) || 20);
const MCP_LIST_SAMPLES = Math.max(1, Number(process.env.MCP_LIST_SAMPLES) || 200);
const MCP_INIT_GATE_MS = Math.max(1, Number(process.env.BENCH_MCP_INIT_GATE_MS) || 2000);
const MCP_LIST_GATE_MS = Math.max(1, Number(process.env.BENCH_MCP_LIST_GATE_MS) || 250);

const SERVERS = [
  {
    name: "brake",
    version: "1.0.0",
    entry: "packages/brake/dist/mcp.js",
    tools: ["brake", "danger_scan", "brake_metrics", "brake_status"],
  },
  {
    name: "redteam",
    version: "1.0.0",
    entry: "packages/redteam/dist/mcp.js",
    tools: ["challenge", "rebut", "compact", "redteam_status"],
  },
  {
    name: "thrift",
    version: "1.0.0",
    entry: "packages/thrift/dist/mcp.js",
    tools: ["read_lean", "run_lean", "check_loop", "compress_text", "thrift_report"],
  },
];

async function handshake(server) {
  const entry = resolve(ROOT, server.entry);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    // Keep the server's stderr off our stdout (the initialize response goes
    // over the same pipe the assertions read); drain it so a chatty server
    // can never block its own pipe.
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});

  const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
  let watchdog;
  try {
    const connectPromise = client.connect(transport); // the initialize handshake
    connectPromise.catch(() => {}); // avoid an unhandled rejection if the watchdog wins
    await Promise.race([
      connectPromise,
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error(`handshake timed out after ${HANDSHAKE_TIMEOUT_MS / 1000}s`)), HANDSHAKE_TIMEOUT_MS);
      }),
    ]);

    const info = client.getServerVersion();
    if (info.name !== server.name || info.version !== server.version) {
      throw new Error(`server identified as ${info.name}@${info.version}, expected ${server.name}@${server.version}`);
    }

    const { tools } = await client.listTools();
    const got = new Set(tools.map((t) => t.name));
    const missing = server.tools.filter((t) => !got.has(t));
    if (missing.length > 0) {
      throw new Error(`missing tools: ${missing.join(", ")} — advertised: ${[...got].sort().join(", ")}`);
    }

    console.log(`  ✓ ${server.name}@${server.version} handshake ok, ${tools.length} tools: ${server.tools.join(", ")}`);
  } finally {
    clearTimeout(watchdog);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

/** Nearest-rank percentile of a sorted ascending array. */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Format a per-call latency: ns for sub-µs, µs for sub-ms, ms after that. */
function fmtMs(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  return `${ms.toFixed(2)}ms`;
}

/**
 * Wire-latency pass (--json). Per server:
 *   initialize — MCP_INIT_SAMPLES fresh spawn+initialize handshakes, each on
 *                its own process (that is what a host pays when it connects);
 *   tools/list — MCP_LIST_SAMPLES round-trips over ONE live connection (the
 *                per-call cost once the host is connected).
 *
 * Gates (p95): initialize ≤ MCP_INIT_GATE_MS (default 2000), tools/list ≤
 * MCP_LIST_GATE_MS (default 250). A wire round-trip over stdio should be
 * sub-ms; anything in the hundreds of ms is a serialization/pipe regression
 * that the in-process latency pass cannot see.
 */
async function wireLatency(server) {
  const entry = resolve(ROOT, server.entry);

  const inits = new Float64Array(MCP_INIT_SAMPLES);
  let listTools = null;
  for (let i = 0; i < MCP_INIT_SAMPLES; i++) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
    let watchdog;
    try {
      const connectPromise = client.connect(transport); // the initialize handshake
      connectPromise.catch(() => {}); // avoid an unhandled rejection if the watchdog wins
      const start = process.hrtime.bigint();
      await Promise.race([
        connectPromise,
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error(`initialize timed out after ${HANDSHAKE_TIMEOUT_MS / 1000}s`)), HANDSHAKE_TIMEOUT_MS);
        }),
      ]);
      inits[i] = Number(process.hrtime.bigint() - start) / 1e6; // ms

      // tools/list round-trips on this connection — once, not per init sample.
      if (listTools === null) {
        listTools = new Float64Array(MCP_LIST_SAMPLES);
        const { tools } = await client.listTools();
        if (!server.tools.every((t) => tools.some((x) => x.name === t))) {
          throw new Error(`missing tools: expected ${server.tools.join(", ")}`);
        }
        for (let j = 0; j < MCP_LIST_SAMPLES; j++) {
          const s = process.hrtime.bigint();
          await client.listTools();
          listTools[j] = Number(process.hrtime.bigint() - s) / 1e6;
        }
      }
    } finally {
      clearTimeout(watchdog);
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  }

  const initSorted = Array.from(inits).sort((a, b) => a - b);
  const listSorted = listTools ? Array.from(listTools).sort((a, b) => a - b) : [0];
  const initialize = {
    samples: MCP_INIT_SAMPLES,
    p50Ms: percentile(initSorted, 50),
    p95Ms: percentile(initSorted, 95),
    p99Ms: percentile(initSorted, 99),
    maxMs: initSorted[initSorted.length - 1],
    gateMs: MCP_INIT_GATE_MS,
  };
  const list = {
    samples: MCP_LIST_SAMPLES,
    p50Ms: percentile(listSorted, 50),
    p95Ms: percentile(listSorted, 95),
    p99Ms: percentile(listSorted, 99),
    maxMs: listSorted[listSorted.length - 1],
    gateMs: MCP_LIST_GATE_MS,
  };
  return {
    name: server.name,
    version: server.version,
    initialize,
    listTools: list,
    ok: initialize.p95Ms <= MCP_INIT_GATE_MS && list.p95Ms <= MCP_LIST_GATE_MS,
  };
}

const jsonMode = process.argv.includes("--json");
let anyFailed = false;

if (jsonMode) {
  const results = [];
  for (const server of SERVERS) {
    try {
      const r = await wireLatency(server);
      results.push(r);
      if (!r.ok) anyFailed = true;
      console.error(
        `  ✓ ${server.name}@${server.version} init p95 ${fmtMs(r.initialize.p95Ms)} · list p95 ${fmtMs(r.listTools.p95Ms)}`
      );
    } catch (err) {
      console.error(`✗ ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
      anyFailed = true;
    }
  }
  // JSON on stdout only; diagnostics went to stderr.
  console.log(JSON.stringify({ mode: "latency", servers: results, ok: !anyFailed }, null, 2));
  process.exit(anyFailed ? 1 : 0);
}

for (const server of SERVERS) {
  try {
    await handshake(server);
  } catch (err) {
    console.error(`✗ ${server.name}: ${err instanceof Error ? err.message : String(err)}`);
    anyFailed = true;
  }
}

console.log(anyFailed ? "\nMCP handshake: FAILED." : "\nMCP handshake: all servers initialize and advertise their tools.");
process.exit(anyFailed ? 1 : 0);
