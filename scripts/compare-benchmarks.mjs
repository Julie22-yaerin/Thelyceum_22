#!/usr/bin/env node
/**
 * The Lyceum — cross-environment latency comparison.
 *
 * Compares the latency pass of benchmark-results.json artifacts across
 * environments: the two cloud archs (x64 + arm64) and — when you pass it —
 * the local dev machine's numbers, so the "cloud number" is checked against
 * the machine the README was written on ("số cloud đối chiếu với máy dev").
 *
 * Usage:
 *   node scripts/compare-benchmarks.mjs [label=path] [label=path] ...
 *
 * Each input is a benchmark-results.json written by scripts/benchmark.mjs.
 * Labels are free-form; "local" marks the dev machine, everything else is a
 * cloud environment. At least two inputs are required.
 *
 * Warnings (::warning:: — a GitHub annotation, non-blocking):
 *   - any two cloud environments whose per-tool p95 drift > BENCH_DRIFT_WARN_X
 *     (default 2.0) in EITHER direction — x64 vs arm64 running the same code
 *     should be within 2x;
 *   - any cloud environment that is > BENCH_DRIFT_WARN_X slower than the
 *     local dev baseline — a cloud runner slower than a laptop is an anomaly
 *     (noisy neighbour, throttling, or a regression that only shows on server
 *     hardware). Local being slower than cloud is expected and never warned.
 *
 * Exit code: 0 even when warnings fire — the benchmark's own floors are the
 * fail gates; drift is a diagnostic. Non-zero only when comparison is
 * impossible (missing/unreadable/malformed input, or fewer than two inputs).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRIFT_WARN_X = Math.max(1, Number(process.env.BENCH_DRIFT_WARN_X) || 2.0);

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("usage: node scripts/compare-benchmarks.mjs [label=path] [label=path] ...");
  process.exit(2);
}

const inputs = args.map((a) => {
  const eq = a.indexOf("=");
  return eq === -1
    ? { label: a.replace(/^.*[\\/]/, "").replace(/\.json$/, ""), path: a }
    : { label: a.slice(0, eq) || "input", path: a.slice(eq + 1) };
});

// Load and validate every input before comparing.
const envs = [];
let loadError = null;
for (const { label, path } of inputs) {
  if (!existsSync(path)) {
    loadError = `missing benchmark artifact: ${path}`;
    break;
  }
  let raw;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    loadError = `cannot read ${path}: ${err.message}`;
    break;
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    loadError = `malformed benchmark artifact ${path}: ${err.message}`;
    break;
  }
  const byTool = new Map();
  for (const m of json.measurements ?? []) {
    // latencyFloorMs lives on the measurement, not on the latency object.
    if (m?.latency) byTool.set(m.tool, { ...m.latency, latencyFloorMs: m.latencyFloorMs ?? 0 });
  }
  envs.push({ label, local: label.toLowerCase() === "local", machine: json.machine, byTool });
}
if (loadError) {
  console.error(loadError);
  process.exit(1);
}

const TOOLS = [...new Set(envs.flatMap((e) => [...e.byTool.keys()]))];

/** Format a per-call latency: ns for sub-µs, µs for sub-ms, ms after that. */
function fmtMs(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`;
  return `${ms.toFixed(2)}ms`;
}

// ── Drift check ────────────────────────────────────────────────────────────
const warnings = [];
for (const tool of TOOLS) {
  for (let i = 0; i < envs.length; i++) {
    for (let j = i + 1; j < envs.length; j++) {
      const a = envs[i];
      const b = envs[j];
      const pa = a.byTool.get(tool)?.p95Ms;
      const pb = b.byTool.get(tool)?.p95Ms;
      if (pa === undefined || pb === undefined) continue;
      const hi = Math.max(pa, pb);
      const lo = Math.min(pa, pb);
      if (lo <= 0) continue;
      const ratio = hi / lo;
      const aSlower = pa > pb;
      const bSlower = pb > pa;
      // Local being slower than cloud is the expected case (dev laptop); only
      // cloud slower than local is anomalous.
      if (a.local && aSlower) continue;
      if (b.local && bSlower) continue;
      if (ratio > DRIFT_WARN_X) {
        const msg = `p95 ${tool} drifts ${ratio.toFixed(1)}x between ${a.label} (${fmtMs(pa)}) and ${b.label} (${fmtMs(pb)}) — above ${DRIFT_WARN_X}x threshold`;
        warnings.push(msg);
        console.warn(`::warning::${msg}`);
      }
    }
  }
}

// ── Human table ────────────────────────────────────────────────────────────
console.log(`Lyceum latency cross-check — drift warn threshold ${DRIFT_WARN_X}x\n`);
for (const e of envs) {
  console.log(
    `  ${e.label.padEnd(10)} ${e.machine?.os ?? "unknown"} · ${e.machine?.cpu ?? "unknown"} · ${e.machine?.cores ?? "?"} cores${e.local ? "  (dev machine)" : ""}`
  );
}
if (TOOLS.length === 0) {
  console.log("\n  no latency data found in any artifact (older benchmark format?)");
} else {
  console.log("\n  tool    env       p50        p95        p99        max        gate");
  for (const tool of TOOLS) {
    for (const e of envs) {
      const l = e.byTool.get(tool);
      if (!l) continue;
      console.log(
        `  ${tool.padEnd(8)}${e.label.padEnd(10)}${fmtMs(l.p50Ms).padStart(9)}  ${fmtMs(l.p95Ms).padStart(9)}  ${fmtMs(l.p99Ms).padStart(9)}  ${fmtMs(l.maxMs).padStart(9)}  ${fmtMs(l.latencyFloorMs).padStart(9)}`
      );
    }
  }
}
console.log(
  warnings.length === 0
    ? "\nNo p95 drift warnings across environments."
    : `\n${warnings.length} p95 drift warning(s):`
);
for (const w of warnings) console.log(`  ⚠ ${w}`);

// ── Markdown summary for $GITHUB_STEP_SUMMARY ──────────────────────────────
const rows = TOOLS.flatMap((tool) => {
  const cells = envs
    .filter((e) => e.byTool.has(tool))
    .map((e) => {
      const l = e.byTool.get(tool);
      return `${e.label}: ${fmtMs(l.p95Ms)}`;
    })
    .join(" · ");
  return [`| ${tool} | ${cells} |`];
}).join("\n");
const warnLines = warnings.map((w) => `- ⚠ ${w}`).join("\n") || "- none";
const md = `## Lyceum latency cross-check (${DRIFT_WARN_X}x drift threshold)

| Tool | p95 per environment |
|---|---|
${rows}

**Warnings:**
${warnLines}

${warnings.length === 0 ? `✅ No p95 drift > ${DRIFT_WARN_X}x between environments.` : "⚠️ " + warnings.length + " p95 drift warning(s) — see annotations."}
`;
writeFileSync(join(ROOT, "benchmark-compare.md"), md);

process.exit(0);
