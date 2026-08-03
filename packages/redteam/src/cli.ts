#!/usr/bin/env node
/**
 * The red team CLI.
 *
 *   redteam challenge "<claim or plan text>"
 *       Scan a claim/plan/reasoning for one-sidedness. Exit 0 if clean,
 *       1 if blocked (a blocking flaw matched or too many flags).
 *
 *   redteam rebut "<claim or plan text>"
 *       Quick devil's advocate: counters + verdict only, no flag audit.
 *
 *   redteam rules
 *       List the flaw rules the red team watches.
 *
 *   redteam status [--limit N]
 *       Show the most recent challenge events from the audit log.
 *
 *   redteam mode (always | slash)
 *       Set / show the mode. 'always' = model challenges its own reasoning
 *       proactively; 'slash' = only when the user types /redteam.
 *
 *   redteam install <target>        claude-desktop | claude-code | chatgpt | all
 *   redteam uninstall <target>
 *   redteam init                    Write ~/.redteam/config.json with defaults.
 *   redteam mcp                     Start the MCP server on stdio.
 *
 *   redteam --version | --help
 */

import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";
import { challenge, rebut, listFlawRules } from "./challenge.js";
import { readAudit } from "./audit.js";
import { loadConfig, DEFAULT_CONFIG_PATH, REDTEAM_HOME } from "./config.js";
import { reportChallenge } from "./notify.js";
import { reportUsageBestEffort } from "./usage.js";
import {
  installClaudeDesktop,
  installClaudeCode,
  installChatGPT,
  installAll,
  uninstallClaudeDesktop,
  uninstallClaudeCode,
  uninstallChatGPT,
  uninstallAll,
} from "./install.js";
import { getMode, setMode, isValidMode, configPath } from "./mode.js";

const HELP = `redteam — the red team. Attack one-sided reasoning before it ships.

Core (no license required):
  redteam challenge "<claim or plan text>"
      Scan a claim, plan, or piece of reasoning for red flags: overconfidence,
      unsupported claims, confirmation bias, false dichotomies, missing
      trade-offs, straw men, anecdote-as-evidence, slippery slopes, unchecked
      assumptions. Prints the flags and the counters. Exit 0 if clean,
      1 if blocked (blocking flaw matched, or 3+ flags).

  redteam rebut "<claim or plan text>"
      Quick devil's advocate: prints only the counter-arguments and verdict.
      Cheap; pipe your answer through it before presenting conclusions.

  redteam rules
      List the flaw rules the red team watches.

  redteam status [--limit N]
      Show the most recent challenge events from the audit log.

  redteam mode
      Show current mode: 'always' (model challenges its own reasoning
      proactively) or 'slash' (only on /redteam).

  redteam mode always | slash
      Set the mode. Restart Claude Desktop / Claude Code to apply.

Install:
  redteam install <target>   claude-desktop | claude-code | chatgpt | all
      Wire the red team into a host, exactly like the brake:
        claude-desktop   MCP server with challenge/rebut tools auto-loaded
        claude-code      PreToolUse hook that challenges every Write/Edit
        chatgpt          Skill file for ChatGPT Skills API
  redteam uninstall <target>

  redteam init
      Write ~/.redteam/config.json with defaults.

  redteam mcp
      Start the MCP server on stdio. Used by hosts that auto-spawn it.

Environment / config (~/.redteam/config.json):
  REDTEAM_AUDIT_PATH         Audit log path (default ~/.redteam/audit.log).
  REDTEAM_WEBHOOK_URL        POST challenge events here (Slack, ops, etc.).
  REDTEAM_BLOCK_ON           Comma-separated flaw classes that block, e.g.
                             "unsupported_claim,confirmation_bias".

The point of the red team is that the model attacks its own conclusion before
presenting it — in 'always' mode by default, or only on /redteam in 'slash'
mode. One-sided reasoning is the shape of a confident mistake.`;

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

function printErr(msg: string): void { console.error(`redteam: ${msg}`); }

/** Read all of stdin as a UTF-8 string. Used by the `challenge -` hook form. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

// ── Commands ───────────────────────────────────────────────────────────────

async function cmdChallenge(rest: string[]): Promise<void> {
  // `redteam challenge -` reads the text from stdin (used by the Claude Code
  // hook, which pipes the proposed change in). Any other arg is the text.
  let text = rest.join(" ").trim();
  if (text === "-") text = (await readStdin()).trim();
  if (!text) {
    printErr("provide a claim or plan to challenge.");
    exit(2);
  }
  const cfg = await loadConfig();
  const result = challenge(text, { blockOn: cfg.blockOn });
  if (result.flags.length > 0) {
    await reportChallenge(cfg, result);
  }
  console.log(JSON.stringify(result, null, 2));
  // Report AFTER the verdict is printed — the exit code is what the hook
  // acts on. Tokens are an estimate (chars/4) of the claim challenged.
  await reportUsageBestEffort({ tool: "redteam", kind: "challenge", tokens: Math.ceil(text.length / 4), calls: 1 });
  exit(result.verdict.blocked ? 1 : 0);
}

async function cmdRebut(rest: string[]): Promise<void> {
  const text = rest.join(" ").trim();
  if (!text) {
    printErr("provide a claim or plan to rebut.");
    exit(2);
  }
  const cfg = await loadConfig();
  const result = rebut(text, { blockOn: cfg.blockOn });
  console.log(JSON.stringify({ text: result.text, counter: result.counter, verdict: result.verdict }, null, 2));
  await reportUsageBestEffort({ tool: "redteam", kind: "rebut", tokens: Math.ceil(text.length / 4), calls: 1 });
  exit(0);
}

async function cmdStatus(rest: string[]): Promise<void> {
  const limit = parseInt(getFlag(rest, "--limit") ?? "20", 10);
  const cfg = await loadConfig();
  const events = await readAudit(limit, cfg.auditPath);
  console.log(JSON.stringify(events, null, 2));
  exit(0);
}

async function cmdMode(rest: string[]): Promise<void> {
  const sub = rest[0];
  const current = await getMode();
  if (!sub) {
    console.log(JSON.stringify({ mode: current, configPath: configPath() }, null, 2));
    return;
  }
  if (!isValidMode(sub)) {
    printErr(`unknown mode: ${sub}. Try 'always' or 'slash'.`);
    exit(2);
  }
  await setMode(sub);
  console.log(`✓ mode set to '${sub}'. Restart Claude Desktop / Claude Code for the new mode to take effect.`);
}

async function cmdInstall(rest: string[]): Promise<void> {
  const target = rest[0] ?? "all";
  const valid = ["claude-desktop", "claude-code", "chatgpt", "all"];
  if (!valid.includes(target)) {
    printErr(`unknown target '${target}'. Try claude-desktop, claude-code, chatgpt, or all.`);
    exit(2);
  }
  if (target === "claude-desktop") await installClaudeDesktop();
  else if (target === "claude-code") await installClaudeCode();
  else if (target === "chatgpt") await installChatGPT();
  else await installAll();
  console.log(`✓ redteam installed into ${target}.`);
}

async function cmdUninstall(rest: string[]): Promise<void> {
  const target = rest[0] ?? "all";
  const valid = ["claude-desktop", "claude-code", "chatgpt", "all"];
  if (!valid.includes(target)) {
    printErr(`unknown target '${target}'. Try claude-desktop, claude-code, chatgpt, or all.`);
    exit(2);
  }
  if (target === "claude-desktop") await uninstallClaudeDesktop();
  else if (target === "claude-code") await uninstallClaudeCode();
  else if (target === "chatgpt") await uninstallChatGPT();
  else await uninstallAll();
  console.log(`✓ uninstalled from ${target}.`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`redteam v${VERSION}`);
    exit(0);
  }

  const [cmd, ...rest] = args;

  try {
    if (cmd === "challenge") return await cmdChallenge(rest);
    if (cmd === "rebut") return await cmdRebut(rest);
    if (cmd === "rules") {
      console.log(JSON.stringify(listFlawRules(), null, 2));
      exit(0);
    }
    if (cmd === "status") return await cmdStatus(rest);
    if (cmd === "mode") return await cmdMode(rest);
    if (cmd === "install") return await cmdInstall(rest);
    if (cmd === "uninstall") return await cmdUninstall(rest);
    if (cmd === "init") {
      await fs.mkdir(REDTEAM_HOME, { recursive: true });
      const example = {
        audit_path: join(homedir(), ".redteam", "audit.log"),
        webhook_url: null,
        block_on: ["unsupported_claim", "confirmation_bias"],
      };
      if (existsSync(DEFAULT_CONFIG_PATH)) {
        printErr(`${DEFAULT_CONFIG_PATH} already exists. Edit it directly.`);
        exit(1);
      }
      await fs.writeFile(DEFAULT_CONFIG_PATH, JSON.stringify(example, null, 2) + "\n", "utf-8");
      console.log(`Wrote ${DEFAULT_CONFIG_PATH}`);
      exit(0);
    }
    if (cmd === "mcp") {
      await import("./mcp.js");
      return;
    }

    printErr(`unknown command '${cmd}'. Run 'redteam --help'.`);
    exit(2);
  } catch (err) {
    if (err instanceof Error) {
      printErr(err.message);
      if (process.env.REDTEAM_DEBUG) console.error(err.stack);
    } else {
      printErr(String(err));
    }
    exit(1);
  }
}

main();
