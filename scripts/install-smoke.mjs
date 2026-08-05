#!/usr/bin/env node
/**
 * The Lyceum — per-OS install smoke (TRIAL_PLAN.md cloud track).
 *
 * Runs on ubuntu / macos / windows runners (see .github/workflows/throughput.yml,
 * job `install-smoke`). It tests the thing the benchmark cannot: that each CLI
 * actually INSTALLS from its packed artifact and runs on that OS — version
 * prints, the danger scan fires, the challenge blocks a one-sided claim, and
 * thrift measures a real directory.
 *
 * Flow per package:
 *   npm pack --pack-destination <tmp>   → the tarball a customer would install
 *   npm install -g <tarball>            → the real install path
 *   <bin> --version / scan / challenge / measure → assert exit codes + output
 *
 * Cross-platform: binaries are resolved by absolute path from the npm global
 * prefix, never by shell PATH, so bash on Windows cannot hide a broken bin
 * link. On Windows, `npm` is `npm.cmd` and a global install produces
 * `<bin>.cmd` shims which Node refuses to spawn directly — both are handled
 * here (npm.cmd for npm, shell:true for the shims).
 *
 * Local run: set SMOKE_PREFIX to a scratch dir to avoid polluting the real
 * global npm:
 *   SMOKE_PREFIX=$(mktemp -d) node scripts/install-smoke.mjs
 *
 * Pass a package name (brake | redteam | thrift) to smoke only that one —
 * useful on a space-constrained machine or when a single package fails on a
 * runner.
 *
 * Exit code: 0 when every package installs and every assertion holds,
 * 1 otherwise.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const SMOKE_PREFIX = process.env.SMOKE_PREFIX; // local scratch; unset in CI

/** npm is npm.cmd on Windows (npm is a .cmd shim there, not an .exe). */
const npmCmd = () => (IS_WIN ? "npm.cmd" : "npm");

/**
 * Run npm. On Windows the npm.cmd shim must go through the shell (spawning a
 * .cmd directly is EINVAL); on unix it spawns directly so a broken npm fails
 * loudly instead of being hidden by the shell. Caveat: with shell:true,
 * spawnSync joins args with spaces and no quoting — acceptable here because
 * CI runner paths (C:\Users\runneradmin\...) contain no spaces.
 */
function runNpm(args, opts = {}) {
  return spawnSync(npmCmd(), args, { encoding: "utf-8", timeout: 120_000, shell: IS_WIN, ...opts });
}

const PKGS = [
  {
    dir: "packages/brake",
    bin: "brake",
    version: "1.0.0",
    checks: [
      { name: "brake --version", args: ["--version"], ok: (r) => r.status === 0 && /brake v1\.0\.0/.test(r.stdout) },
      {
        name: "brake scan (danger → exit 1)",
        args: ["scan", "export all customer records to s3"],
        ok: (r) => r.status === 1 && /matched/.test(r.stdout + r.stderr),
      },
      {
        name: "brake scan (safe → exit 0)",
        args: ["scan", "summarize this ticket"],
        ok: (r) => r.status === 0 && /"danger": ?false/.test(r.stdout),
      },
    ],
  },
  {
    dir: "packages/redteam",
    bin: "redteam",
    version: "1.0.0",
    checks: [
      { name: "redteam --version", args: ["--version"], ok: (r) => r.status === 0 && /redteam v1\.0\.0/.test(r.stdout) },
      {
        name: "redteam challenge (one-sided → exit 1)",
        args: ["challenge", "Research shows this migration is totally safe."],
        ok: (r) => r.status === 1 && /blocked/.test(r.stdout),
      },
      {
        name: "redteam challenge (balanced → exit 0)",
        args: ["challenge", "I recommend Postgres for this workload; the migration risk is downtime and we have a rollback plan."],
        ok: (r) => r.status === 0,
      },
    ],
  },
  {
    dir: "packages/thrift",
    bin: "thrift",
    version: "1.0.0",
    // thrift deliberately has no --version (see cli.ts) — its smoke is that
    // `measure` actually walks and reports a real before/after.
    checks: [
      {
        name: "thrift measure (real dir → before/after)",
        args: ["measure", resolve(ROOT, "packages", "brake", "src"), "--passes", "1"],
        ok: (r) => r.status === 0 && /before/.test(r.stdout) && /after/.test(r.stdout),
      },
    ],
  },
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

/** The npm global bin directory: scratch prefix if SMOKE_PREFIX set, else the real one. */
function globalBinDir() {
  if (SMOKE_PREFIX) return join(SMOKE_PREFIX, IS_WIN ? "" : "bin");
  const prefix = runNpm(["prefix", "-g"]);
  if (prefix.status !== 0) {
    throw new Error(`npm prefix -g failed: ${(prefix.stderr || prefix.stdout).slice(0, 400)}`);
  }
  return join(prefix.stdout.trim(), IS_WIN ? "" : "bin");
}

/** Absolute path to a globally-installed bin, .cmd on Windows. */
function binPath(binDir, bin) {
  return join(binDir, IS_WIN ? `${bin}.cmd` : bin);
}

function run(bin, args) {
  // Windows .cmd shims cannot be spawned directly (EINVAL); they need the
  // shell. Unix bins are spawned directly so a broken shebang fails loudly.
  return spawnSync(bin, args, { encoding: "utf-8", timeout: 60_000, shell: IS_WIN });
}

const tmp = mkdtempSync(join(tmpdir(), "lyceum-smoke-"));
let anyFailed = false;

const ONLY = process.argv[2];
if (ONLY && !PKGS.some((p) => p.bin === ONLY)) {
  console.error(`Unknown package '${ONLY}'. Choose from: ${PKGS.map((p) => p.bin).join(", ")}`);
  process.exit(2);
}

for (const pkg of PKGS) {
  if (ONLY && pkg.bin !== ONLY) continue;
  const pkgDir = resolve(ROOT, pkg.dir);
  console.log(`\n── ${pkg.bin} ──`);

  // 1. Pack the artifact exactly as a customer would download it.
  const packOut = runNpm(["pack", "--silent", "--pack-destination", tmp], { cwd: pkgDir });
  const tarballName = (packOut.stdout || "").trim().split("\n").pop();
  const tarball = join(tmp, tarballName);
  if (packOut.status !== 0 || !existsSync(tarball)) {
    fail(`${pkg.bin}: npm pack failed (exit ${packOut.status})\n${(packOut.stderr || packOut.stdout).slice(0, 400)}`);
    anyFailed = true;
    continue;
  }

  // 2. Install globally — the real install path (or into SMOKE_PREFIX locally).
  const installArgs = ["install", "-g", tarball];
  if (SMOKE_PREFIX) installArgs.push("--prefix", SMOKE_PREFIX);
  const inst = runNpm(installArgs);
  if (inst.status !== 0) {
    fail(`${pkg.bin}: npm install -g failed\n${(inst.stderr || inst.stdout).slice(0, 800)}`);
    anyFailed = true;
    continue;
  }

  // 3. Resolve the bin and run every check against the installed artifact.
  const bin = binPath(globalBinDir(), pkg.bin);
  if (!existsSync(bin)) {
    fail(`${pkg.bin}: installed bin not found at ${bin}`);
    anyFailed = true;
    continue;
  }
  for (const check of pkg.checks) {
    const r = run(bin, check.args);
    const ok = check.ok(r);
    if (ok) {
      console.log(`  ✓ ${check.name}`);
    } else {
      fail(`${pkg.bin}: ${check.name} — exit ${r.status}\n  stdout: ${(r.stdout || "").slice(0, 300)}\n  stderr: ${(r.stderr || "").slice(0, 300)}`);
      anyFailed = true;
    }
  }
}

rmSync(tmp, { recursive: true, force: true });

console.log(anyFailed ? "\nInstall smoke: FAILED." : "\nInstall smoke: all packages install and behave on this OS.");
process.exit(anyFailed ? 1 : 0);
