#!/usr/bin/env node
/**
 * The brake CLI.
 *
 *   brake engage [--reason <text>] [--sla <ms>] [--dry-run]
 *   brake scan "<intent text>"
 *   brake status
 *   brake track <pid> <label>     Register a PID the brake should kill.
 *   brake untrack <label>         Remove a tracked PID.
 *   brake install <target>        claude-desktop | claude-code | chatgpt | all
 *   brake uninstall <target>
 *   brake init                    Write ~/.brake/config.json with defaults.
 *   brake mcp                     Start the MCP server on stdio.
 *   brake --version | --help
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { engageBrake, DEFAULT_POLICY } from "./brake.js";
import { scanForDanger, listDangerRules } from "./danger.js";
import { makeStopAll, trackPid, untrackPid } from "./stop-all.js";
import { readAudit } from "./audit.js";
import { loadConfig, DEFAULT_CONFIG_PATH, BRAKE_HOME } from "./config.js";
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

const HELP = `brake — emergency brake, 1000ms SLA.

Usage:
  brake engage [--reason <text>] [--sla <ms>] [--dry-run]
      Pull the brake. Stops everything tracked in the PID dir, runs the
      optional stop script, posts to the optional webhook, writes the
      audit line. Exit 0 on success, 1 on SLA miss, 2 on total failure.

  brake scan "<intent text>"
      Scan a planned action for danger before it runs. Exit 0 if safe,
      1 if danger detected (with the matched class on stderr).

  brake status [--limit N]
      Show the most recent brake events from the audit log.

  brake track <pid> <label>
      Register a PID the brake should kill on next engage. Idempotent.

  brake untrack <label>
      Remove a tracked PID.

  brake init
      Write ~/.brake/config.json with defaults so future installs read it.

  brake install <target>
      Wire the brake into a host. Targets:
        claude-desktop   Adds an MCP server to Claude Desktop (auto-loaded).
        claude-code      Adds a PreToolUse hook that auto-scans every Bash.
        chatgpt          Writes the skill file to ~/.brake/skills/.
        all              All three.

  brake uninstall <target>
      Reverse the install.

  brake mcp
      Start the MCP server on stdio. Used by hosts that auto-spawn it.

  brake --version
  brake --help

Environment / config (see also ~/.brake/config.json):
  BRAKE_SLA_MS             Default SLA in ms (default 1000).
  BRAKE_PID_DIR            Directory of *.pid files to kill (default ~/.brake/pids).
  BRAKE_AUDIT_PATH         Audit log path (default ~/.brake/audit.log).
  BRAKE_WEBHOOK_URL        POST brake events here.
  BRAKE_STOP_SCRIPT        Run this script on brake (e.g. k8s rollback cmd).

The point of the brake is that pulling it actually stops things, fast, and
the SLA is measured so a brake that quietly ran slow gets reported rather
than hidden.`;

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`brake v${VERSION}`);
    process.exit(0);
  }

  const [cmd, ...rest] = args;

  if (cmd === "engage") {
    const cfg = await loadConfig();
    const reason = getFlag(rest, "--reason") ?? "Operator pulled the emergency brake.";
    const sla = parseInt(getFlag(rest, "--sla") ?? String(cfg.slaMs), 10);
    const dryRun = rest.includes("--dry-run");

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            wouldEngage: true,
            reason,
            policy: { ...DEFAULT_POLICY, brakeSlaMs: sla },
            pidDir: cfg.pidDir,
            auditPath: cfg.auditPath,
            webhookUrl: cfg.webhookUrl ?? null,
            stopScript: cfg.stopScript ?? null,
          },
          null,
          2
        )
      );
      process.exit(0);
    }

    const result = await engageBrake({
      reason,
      policy: { ...DEFAULT_POLICY, brakeSlaMs: sla },
      stopAll: makeStopAll({
        pidDir: cfg.pidDir,
        auditPath: cfg.auditPath,
        webhookUrl: cfg.webhookUrl,
        stopScript: cfg.stopScript,
      }),
    });
    console.log(JSON.stringify(result, null, 2));
    // Exit code: 0 = engaged within SLA, 1 = engaged but over SLA, 2 = did not engage.
    if (!result.engaged) process.exit(2);
    if (!result.withinSla) process.exit(1);
    process.exit(0);
  }

  if (cmd === "scan") {
    const intent = rest.join(" ").trim();
    if (!intent) {
      console.error("brake scan: provide an intent string to scan.");
      process.exit(2);
    }
    const danger = scanForDanger(intent);
    if (danger) {
      console.error(JSON.stringify({ matched: true, ...danger }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ danger: false }, null, 2));
    process.exit(0);
  }

  if (cmd === "status") {
    const limit = parseInt(getFlag(rest, "--limit") ?? "20", 10);
    const cfg = await loadConfig();
    const events = await readAudit(limit, cfg.auditPath);
    console.log(JSON.stringify(events, null, 2));
    process.exit(0);
  }

  if (cmd === "track") {
    const pidStr = rest[0];
    const label = rest[1];
    if (!pidStr || !label) {
      console.error("brake track: usage: brake track <pid> <label>");
      process.exit(2);
    }
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      console.error(`brake track: invalid pid: ${pidStr}`);
      process.exit(2);
    }
    const cfg = await loadConfig();
    await trackPid(pid, label, cfg.pidDir);
    console.log(JSON.stringify({ tracked: { pid, label, pidDir: cfg.pidDir } }, null, 2));
    process.exit(0);
  }

  if (cmd === "untrack") {
    const label = rest[0];
    if (!label) {
      console.error("brake untrack: usage: brake untrack <label>");
      process.exit(2);
    }
    const cfg = await loadConfig();
    await untrackPid(label, cfg.pidDir);
    console.log(JSON.stringify({ untracked: { label } }, null, 2));
    process.exit(0);
  }

  if (cmd === "init") {
    await fs.mkdir(BRAKE_HOME, { recursive: true });
    const cfg = await loadConfig();
    const example = {
      sla_ms: cfg.slaMs,
      pid_dir: cfg.pidDir,
      audit_path: cfg.auditPath,
      webhook_url: cfg.webhookUrl,
      stop_script: cfg.stopScript,
    };
    if (existsSync(DEFAULT_CONFIG_PATH)) {
      console.error(`brake init: ${DEFAULT_CONFIG_PATH} already exists. Edit it directly.`);
      process.exit(1);
    }
    await fs.writeFile(DEFAULT_CONFIG_PATH, JSON.stringify(example, null, 2) + "\n", "utf-8");
    console.log(`Wrote ${DEFAULT_CONFIG_PATH}`);
    process.exit(0);
  }

  if (cmd === "install") {
    const target = rest[0] ?? "all";
    if (target === "claude-desktop") await installClaudeDesktop();
    else if (target === "claude-code") await installClaudeCode();
    else if (target === "chatgpt") await installChatGPT();
    else if (target === "all") await installAll();
    else {
      console.error(`brake install: unknown target '${target}'. Try claude-desktop, claude-code, chatgpt, or all.`);
      process.exit(2);
    }
    console.log(`✓ installed brake into ${target}.`);
    process.exit(0);
  }

  if (cmd === "uninstall") {
    const target = rest[0] ?? "all";
    if (target === "claude-desktop") await uninstallClaudeDesktop();
    else if (target === "claude-code") await uninstallClaudeCode();
    else if (target === "chatgpt") await uninstallChatGPT();
    else if (target === "all") await uninstallAll();
    else {
      console.error(`brake uninstall: unknown target '${target}'.`);
      process.exit(2);
    }
    console.log(`✓ uninstalled brake from ${target}.`);
    process.exit(0);
  }

  if (cmd === "mcp") {
    // Hand off to the MCP server entrypoint. Dynamic import so CLI can be
    // bundled without the MCP SDK when MCP is not desired.
    await import("./mcp.js");
    return;
  }

  if (cmd === "rules") {
    console.log(JSON.stringify(listDangerRules(), null, 2));
    process.exit(0);
  }

  console.error(`brake: unknown command '${cmd}'. Run 'brake --help'.`);
  process.exit(2);
}

main().catch((err) => {
  console.error("brake: fatal:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
