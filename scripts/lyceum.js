#!/usr/bin/env node

/**
 * The Lyceum CLI — one entry point for brake, redteam, and thrift.
 *
 *   • brake    — stops a dangerous action before it runs
 *   • redteam  — stops a one-sided conclusion before it ships
 *   • thrift   — stops the token bill from running away
 *
 * All paths below resolve relative to this file (import.meta.url), not
 * process.cwd() — the old version resolved against cwd, which only ever
 * worked by accident (falling through to a PATH lookup) for anyone not
 * running from inside the repo checkout.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const pkgPath = (pkg, ...parts) => `${ROOT}packages/${pkg}/${parts.join("/")}`;

const c = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[38;5;203m", violet: "\x1b[38;5;141m", amber: "\x1b[38;5;221m",
  green: "\x1b[38;5;114m", gray: "\x1b[38;5;244m", white: "\x1b[1m",
};

function printBanner() {
  console.log(
    `\n  ${c.red}◆${c.reset} ${c.bold}THE LYCEUM${c.reset}  ${c.gray}circuit breakers for AI agents${c.reset}\n`
  );
}

function printHelp() {
  printBanner();
  console.log(`${c.bold}Usage${c.reset}  lyceum <command> [options]

${c.bold}Commands${c.reset}
  ${c.white}activate${c.reset} <code>   Unlock brake, redteam, and thrift with one license code
  ${c.white}status${c.reset}            Token savings and blocked-event dashboard, real numbers
  ${c.white}share${c.reset}             A README badge built from your own measurements
  ${c.white}brake${c.reset} ...         ${c.red}●${c.reset} stops a dangerous action — scan, engage, install
  ${c.white}redteam${c.reset} ...       ${c.violet}●${c.reset} stops a one-sided conclusion — challenge, rebut, install
  ${c.white}thrift${c.reset} ...        ${c.amber}●${c.reset} stops the token bill — measure, compress, install

  Each tool has its own subcommands — run e.g. ${c.dim}lyceum brake --help${c.reset} for the full list.
`);
}

function runSubCli(pkg, subArgs) {
  const distPath = pkgPath(pkg, "dist/cli.js");
  const srcPath = pkgPath(pkg, "src/cli.ts");
  if (existsSync(distPath)) {
    execFileSync(process.execPath, [distPath, ...subArgs], { stdio: "inherit" });
  } else if (existsSync(srcPath)) {
    execFileSync("npx", ["tsx", srcPath, ...subArgs], { stdio: "inherit" });
  } else {
    execFileSync(pkg, subArgs, { stdio: "inherit" });
  }
}

// ── status: real numbers, not decoration ────────────────────────────────

function bar(fraction, width = 28) {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${c.green}${"█".repeat(filled)}${c.gray}${"░".repeat(width - filled)}${c.reset}`;
}

function fmt(n) {
  return Math.round(n).toLocaleString();
}

async function printStatus() {
  printBanner();

  // brake — blocked events, tokens/dollars saved
  try {
    const { getBrakeMetrics } = await import(pkgPath("brake", "dist/audit.js"));
    const m = await getBrakeMetrics();
    if (m.totalEvents === 0) throw new Error("empty");
    console.log(`  ${c.red}●${c.reset} ${c.bold}brake${c.reset}    ${c.dim}${m.totalEvents} event(s) logged${c.reset}`);
    console.log(
      `    ${fmt(m.blockedEvents)} blocked  ·  ${fmt(m.totalTokensSaved)} tokens saved  ·  $${m.totalDollarsSaved.toFixed(2)} saved  ·  ${m.slaCompliancePct}% within SLA\n`
    );
  } catch {
    console.log(`  ${c.red}●${c.reset} ${c.bold}brake${c.reset}    ${c.dim}no activity yet — run \`brake scan\` to try it${c.reset}\n`);
  }

  // redteam — flagged vs total, from the raw audit log (no summary helper exists yet)
  try {
    const { readAudit } = await import(pkgPath("redteam", "dist/audit.js"));
    const events = (await readAudit(1000)).filter((e) => e.event === "challenge_flagged");
    if (events.length === 0) throw new Error("empty");
    const blocked = events.filter((e) => e.blocked === true).length;
    console.log(`  ${c.violet}●${c.reset} ${c.bold}redteam${c.reset}  ${c.dim}${events.length} challenge(s) logged${c.reset}`);
    console.log(`    ${fmt(blocked)} blocked of ${fmt(events.length)}\n`);
  } catch {
    console.log(`  ${c.violet}●${c.reset} ${c.bold}redteam${c.reset}  ${c.dim}no activity yet — run \`redteam challenge "<claim>"\` to try it${c.reset}\n`);
  }

  // thrift — the token-savings ledger, with a real bar chart
  try {
    const { summarise } = await import(pkgPath("thrift", "dist/ledger.js"));
    const s = await summarise();
    if (s.calls === 0) throw new Error("empty");
    console.log(`  ${c.amber}●${c.reset} ${c.bold}thrift${c.reset}   ${c.dim}${fmt(s.calls)} compression(s) logged${c.reset}`);
    console.log(`    before  ${fmt(s.beforeTokens)} tokens`);
    console.log(`    after   ${fmt(s.afterTokens)} tokens`);
    console.log(`    saved   ${fmt(s.savedTokens)} tokens  (${(s.savedFraction * 100).toFixed(1)}%)`);
    console.log(`    ${bar(s.savedFraction)}  ${(s.savedFraction * 100).toFixed(1)}% saved`);
    console.log(`    ${c.dim}${fmt(s.losslessSavedTokens)} lossless (dedupe/noise) · ${fmt(s.lossySavedTokens)} lossy (truncation)${c.reset}\n`);
  } catch {
    console.log(`  ${c.amber}●${c.reset} ${c.bold}thrift${c.reset}   ${c.dim}no activity yet — run \`thrift measure .\` to try it${c.reset}\n`);
  }
}

// ── share: a badge built from YOUR numbers, not a fixed claim ──────────
// The shields.io badge text is generated from this machine's own ledger —
// if nothing has run yet, this says so instead of printing a made-up
// number. A badge nobody can reproduce isn't a badge worth pasting.

function badgeUrl(label, message, color) {
  const enc = (s) => encodeURIComponent(s).replace(/-/g, "--").replace(/_/g, "__");
  return `https://img.shields.io/badge/${enc(label)}-${enc(message)}-${color}`;
}

async function printShareCard() {
  printBanner();

  let badge = null;

  // Prefer the snapshot `thrift measure` writes — that's an actual benchmark
  // run, which is what a badge is claiming. Fall back to the cumulative
  // ledger (real usage, not a one-off measurement) if no snapshot exists yet.
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const snapPath = join(process.env.THRIFT_HOME ?? join(homedir(), ".thrift"), "last-measure.json");
    const snap = JSON.parse(await readFile(snapPath, "utf-8"));
    const pct = (snap.savedFraction * 100).toFixed(1);
    badge = { alt: "Lyceum tokens saved", url: badgeUrl("tokens saved", `${pct}%`, "brightgreen") };
  } catch {
    // no snapshot — try the ledger next
  }

  if (!badge) {
    try {
      const { summarise } = await import(pkgPath("thrift", "dist/ledger.js"));
      const s = await summarise();
      if (s.calls > 0) {
        const pct = (s.savedFraction * 100).toFixed(1);
        badge = {
          alt: "Lyceum tokens saved",
          url: badgeUrl("tokens saved", `${pct}%`, "brightgreen"),
        };
      }
    } catch {
      // no ledger either — fall through to the generic badge below
    }
  }

  if (!badge) {
    badge = { alt: "Protected by The Lyceum", url: badgeUrl("protected by", "the lyceum", "e0342c") };
    console.log(`  ${c.dim}No local measurements yet — showing the generic badge.${c.reset}`);
    console.log(`  ${c.dim}Run \`thrift measure .\` first for a badge with YOUR real number.${c.reset}\n`);
  }

  const md = `[![${badge.alt}](${badge.url})](https://thelyceum.site)`;
  console.log(`  ${c.bold}Paste this into your README:${c.reset}\n`);
  console.log(`  ${c.dim}${md}${c.reset}\n`);
  printWatermark();
}

function printWatermark() {
  console.log(
    `${c.dim}⚡ Powered by The Lyceum (thelyceum.site) — run \`lyceum share\` for a badge built from your own numbers${c.reset}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "status" || command === "metrics") {
    await printStatus();
    printWatermark();
    return;
  }

  if (command === "share") {
    await printShareCard();
    return;
  }

  if (command === "activate") {
    runSubCli("brake", ["activate", ...args.slice(1)]);
    return;
  }

  if (command === "redteam") {
    runSubCli("redteam", args.slice(1));
    return;
  }

  if (command === "brake") {
    runSubCli("brake", args.slice(1));
    return;
  }

  if (command === "thrift" || command === "savier" || command === "saver") {
    runSubCli("thrift", args.slice(1));
    return;
  }

  console.log(`${c.red}Unknown command: ${command}${c.reset}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`${c.red}lyceum:${c.reset}`, err.message ?? err);
  process.exit(1);
});
