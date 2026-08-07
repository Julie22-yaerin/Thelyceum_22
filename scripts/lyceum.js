#!/usr/bin/env node

/**
 * The Lyceum CLI — Unified Control Center for AI Agent Safeguards.
 *
 *   • Red Team (@lyceum/redteam) : Context Compacting & Anti-Drift Scanner
 *   • Brake    (@lyceum/brake)   : Cyber Security & Data Leak Safeguard
 *   • Thrift   (@lyceum/thrift)  : Token Economy & Runaway Loop Interceptor (Max 2 repetitions)
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync, execFileSync } from "node:child_process";

const LOGO_PATH = resolve("lyceum_logo.png");

// Burning Fire ANSI Art Banner
function printFireBanner() {
  const fireAscii = `
\x1b[38;5;202m        (  .      )                      \x1b[0m
\x1b[38;5;208m       )  (   )  (                       \x1b[0m
\x1b[38;5;214m      (  (  (   )  )                     \x1b[0m
\x1b[38;5;220m     /\x1b[38;5;226m\\/\x1b[38;5;220m\\/\x1b[38;5;226m\\/\x1b[38;5;220m\\/\x1b[38;5;226m\\/\x1b[38;5;220m\\/\x1b[38;5;226m\\/\x1b[38;5;220m\\                    \x1b[0m
\x1b[38;5;202m  /\x1b[38;5;208m/\\/\x1b[38;5;214m\\/\x1b[38;5;220m\\/\x1b[38;5;226m\\/\x1b[38;5;220m\\/\x1b[38;5;214m\\/\x1b[38;5;208m\\/\x1b[38;5;202m\\/\x1b[38;5;196m\\                   \x1b[0m
\x1b[38;5;196m /\x1b[38;5;202m/\\/\x1b[38;5;208m\\/\x1b[38;5;214m\\  \x1b[1m\x1b[38;5;231mTHE LYCEUM\x1b[0m\x1b[38;5;214m  /\x1b[38;5;208m\\/\x1b[38;5;202m\\/\x1b[38;5;196m\\                  \x1b[0m
\x1b[38;5;202m \\\x1b[38;5;208m\\/\x1b[38;5;214m\\/\x1b[38;5;220m\\/\x1b[38;5;226m\\/\x1b[38;5;220m\\/\x1b[38;5;214m\\/\x1b[38;5;208m\\/\x1b[38;5;202m\\/\x1b[38;5;196m/                   \x1b[0m
\x1b[38;5;39m   \\/\x1b[38;5;45m\\/\x1b[38;5;51m CIRCUIT BREAKERS FOR AI \x1b[38;5;45m\\/\x1b[38;5;39m/                    \x1b[0m
`;

  console.log(fireAscii);
  if (existsSync(LOGO_PATH)) {
    console.log(`\x1b[34m[Logo Image]\x1b[0m file://${LOGO_PATH}\n`);
  }
}

function printHelp() {
  printFireBanner();
  console.log(`\x1b[1mUsage:\x1b[0m lyceum <command> [options]

\x1b[1mCommands:\x1b[0m
  \x1b[36mstatus\x1b[0m        Display active safeguard status & token savings metrics
  \x1b[36mredteam\x1b[0m       Run Red Team scanner (compacting, advice, flaw checks)
  \x1b[36mbrake\x1b[0m         Invoke Brake security scanner & PID emergency brake
  \x1b[36mthrift\x1b[0m        Token economy & runaway loop interceptor (Max 2 reps)

\x1b[1mSafeguard Roles:\x1b[0m
  • \x1b[33mBrake\x1b[0m   Strictly handles Security & Cyber risks (exfiltration, creds, attacks)
  • \x1b[32mThrift\x1b[0m  Handles Token Economy & Runaway Loops (Trips if repeated > 2 times)
  • \x1b[35mRedTeam\x1b[0m Handles Context Compacting & Code Flaw Advice (Warn vs Block)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "status" || command === "metrics") {
    printFireBanner();
    console.log(`\x1b[1m=== THE LYCEUM SYSTEM STATUS ===\x1b[0m`);
    console.log(`\x1b[32m✔ Red Team Core\x1b[0m: ACTIVE (Goldilocks Context Compacter + Dual-Tier Code Flaws)`);
    console.log(`\x1b[32m✔ Brake Security\x1b[0m: ACTIVE (Local & Cloud Engine, 1000ms SLA)`);
    console.log(`\x1b[32m✔ Thrift\x1b[0m: ACTIVE (Runaway Loop Interceptor, Max 2 Repetitions)`);
    console.log(`\x1b[34m✔ Logo Asset\x1b[0m   : file://${LOGO_PATH}\n`);
    return;
  }

  function runSubCli(pkgName, subArgs) {
    const distPath = resolve(`packages/${pkgName}/dist/cli.js`);
    const srcPath = resolve(`packages/${pkgName}/src/cli.ts`);
    if (existsSync(distPath)) {
      execFileSync(process.execPath, [distPath, ...subArgs], { stdio: "inherit" });
    } else if (existsSync(srcPath)) {
      execFileSync("npx", ["tsx", srcPath, ...subArgs], { stdio: "inherit" });
    } else {
      execFileSync(pkgName, subArgs, { stdio: "inherit" });
    }
  }

  if (command === "redteam") {
    runSubCli("redteam", args.slice(1));
    return;
  }

  if (command === "brake") {
    runSubCli("brake", args.slice(1));
    return;
  }

  if (command === "savier" || command === "saver" || command === "thrift") {
    runSubCli("thrift", args.slice(1));
    return;
  }

  console.log(`\x1b[31mUnknown command: ${command}\x1b[0m`);
  printHelp();
}

main().catch((err) => {
  console.error("Lyceum CLI Error:", err);
  process.exit(1);
});
