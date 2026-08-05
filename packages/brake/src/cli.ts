#!/usr/bin/env node
/**
 * The brake CLI (Local & Cloud).
 *
 *   brake engage [--reason <text>] [--sla <ms>] [--dry-run]
 *   brake scan "<intent text>"
 *   brake metrics
 *   brake status
 *   brake track <pid> <label>
 *   brake untrack <label>
 *
 *   brake install <target>        claude-desktop | claude-code | chatgpt | all
 *   brake uninstall <target>
 *   brake init                    Write ~/.brake/config.json with defaults.
 *   brake mcp                     Start the MCP server on stdio.
 *
 *   brake --version | --help
 */

import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";
import { engageBrake, DEFAULT_POLICY } from "./brake.js";
import { scanForDanger, listDangerRules } from "./danger.js";
import { makeStopAll, trackPid, untrackPid } from "./stop-all.js";
import { readAudit, appendAudit, getBrakeMetrics } from "./audit.js";
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
import {
  loadLicense,
  loadSession,
  saveLicense,
  saveSession,
  clearLicense,
  callSignup,
  callLogin,
  callFetchLicense,
  callMe,
  callListInstalls,
  callRegisterInstall,
  callUnregisterInstall,
  callReportUsage,
  getServerUrl,
} from "./license.js";
import { getMode, setMode, isValidMode, configPath } from "./mode.js";
import { getDeviceId, getDeviceMeta } from "./device.js";

const HELP = `brake — emergency brake, 1000ms SLA (Local & Cloud).

Core:
  brake engage [--reason <text>] [--sla <ms>] [--dry-run]
      Pull the emergency brake. Stops tracked PIDs / cloud processes, runs the
      optional stop script, posts webhook, logs token savings, and audits.

  brake scan "<intent text>"
      Scan a planned action for danger before it runs (data leak, runaway loop, etc.).
      Calculates saved tokens and estimated financial savings if blocked.

  brake metrics
      Show summary statistics: total blocked events, total tokens saved, money saved,
      and SLA compliance percentage across local & cloud environments.

  brake status [--limit N]
      Show the most recent brake events from the audit log.

  brake track <pid> <label>
  brake untrack <label>

Install:
  brake install <target>   claude-desktop | claude-code | chatgpt | all
  brake uninstall <target>
  brake init
  brake mcp

Environment / config (~/.brake/config.json):
  BRAKE_ENVIRONMENT        Environment mode ('cloud' or 'local').
  BRAKE_CLOUD_REGION       Cloud region tag (default 'us-east-1').
  BRAKE_SLA_MS             Default SLA in ms (default 1000).
  BRAKE_PID_DIR            Directory of *.pid files to kill.
  BRAKE_AUDIT_PATH         Audit log path.
  BRAKE_WEBHOOK_URL        POST brake events here.
  BRAKE_STOP_SCRIPT        Run this script on brake.`;

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function prompt(question: string, silent = false): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error(`missing required input: ${question}`);
  }
  if (silent) {
    process.stderr.write(question);
    return new Promise((resolve) => {
      let buf = "";
      const onData = (chunk: Buffer) => {
        const s = chunk.toString("utf-8");
        for (const ch of s) {
          if (ch === "\n" || ch === "\r") {
            stdin.removeListener("data", onData);
            stdin.pause();
            process.stderr.write("\n");
            resolve(buf);
            return;
          }
          buf += ch;
          process.stderr.write("*");
        }
      };
      stdin.on("data", onData);
      stdin.resume();
    });
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function printErr(msg: string): void { console.error(`brake: ${msg}`); }

async function reportUsageBestEffort(input: Parameters<typeof callReportUsage>[0]): Promise<void> {
  try {
    await Promise.race([
      callReportUsage(input),
      new Promise((_, reject) => setTimeout(() => reject(new Error("usage report timed out")), 150)),
    ]);
  } catch {
    // best effort
  }
}

function formatExpiry(ts: number): string {
  return new Date(ts).toLocaleString();
}

// ── Commands ───────────────────────────────────────────────────────────────

async function cmdLogin(rest: string[]): Promise<void> {
  let email = getFlag(rest, "--email");
  let password = getFlag(rest, "--password");
  const signupFlag = rest.includes("--signup");

  if (!email) email = await prompt("email: ");
  if (!password) password = await prompt("password: ", true);

  console.log(`→ contacting ${getServerUrl()} ...`);
  let result;
  try {
    result = signupFlag
      ? await callSignup({ email: email!, password: password! })
      : await callLogin({ email: email!, password: password! });
  } catch (err) {
    if (err instanceof Error) printErr(err.message);
    exit(1);
  }

  await saveSession({ token: result.sessionToken, email: result.user.email, fetchedAt: Date.now() });
  console.log(`✓ signed in as ${result.user.email}`);

  try {
    const lic = await callFetchLicense();
    await saveLicense({
      token: lic.token,
      plan: lic.plan,
      billing: lic.billing,
      expiresAt: lic.expiresAt,
      autoRenew: lic.autoRenew,
      fetchedAt: Date.now(),
    });
    console.log(`✓ license: ${lic.plan} (${lic.billing}), expires ${formatExpiry(lic.expiresAt)}`);
  } catch (err) {
    if (err instanceof Error && /no_subscription|expired|not_active/i.test(err.message)) {
      console.log(`! no active subscription yet. Visit ${getServerUrl()}/ to pick a plan.`);
    } else {
      console.log(`! could not fetch license: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function cmdLogout(): Promise<void> {
  await clearLicense();
  console.log("✓ signed out. local license and session removed.");
}

async function cmdLicense(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === "refresh") {
    const session = await loadSession();
    if (!session) {
      printErr("not logged in — run `brake login` first");
      exit(1);
    }
    try {
      const lic = await callFetchLicense();
      await saveLicense({
        token: lic.token,
        plan: lic.plan,
        billing: lic.billing,
        expiresAt: lic.expiresAt,
        autoRenew: lic.autoRenew,
        fetchedAt: Date.now(),
      });
      console.log(`✓ license refreshed.`);
    } catch (err) {
      if (err instanceof Error) printErr(err.message);
      exit(1);
    }
    return;
  }

  const session = await loadSession();
  const lic = await loadLicense();
  let me;
  try {
    me = await callMe();
  } catch (err) {
    if (err instanceof Error) printErr(`server unreachable: ${err.message}`);
    exit(1);
  }

  const sub2 = me.subscription;
  console.log(JSON.stringify({
    email: me.user.email,
    server: getServerUrl(),
    loggedIn: !!session,
    license: lic
      ? {
          plan: lic.plan,
          billing: lic.billing,
          expiresAt: lic.expiresAt,
          expiresAtHuman: formatExpiry(lic.expiresAt),
          autoRenew: lic.autoRenew,
          fetchedAt: lic.fetchedAt,
        }
      : null,
    subscription: sub2
      ? {
          plan: sub2.plan,
          billing: sub2.billing,
          status: sub2.status,
          expiresAt: sub2.expires_at,
          expiresAtHuman: formatExpiry(sub2.expires_at),
          autoRenew: sub2.auto_renew === 1,
        }
      : null,
    connections: { used: me.connectionCount, limit: me.connectionLimit },
  }, null, 2));
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

async function cmdConnections(): Promise<void> {
  const session = await loadSession();
  if (!session) {
    printErr("not logged in — run `brake login` first");
    exit(1);
  }
  let me;
  try {
    me = await callListInstalls();
  } catch (err) {
    if (err instanceof Error) printErr(err.message);
    exit(1);
  }
  console.log(JSON.stringify({
    total: me.total,
    limit: me.limit,
    installs: me.installs.map((i) => ({
      id: i.id,
      hostType: i.host_type,
      deviceId: i.device_id,
      lastSeen: formatExpiry(i.last_seen_at),
    })),
  }, null, 2));
}

async function cmdMetrics(): Promise<void> {
  const cfg = await loadConfig();
  const metrics = await getBrakeMetrics(cfg.auditPath);
  console.log(JSON.stringify(metrics, null, 2));
  exit(0);
}

async function cmdInstall(rest: string[]): Promise<void> {
  const target = rest[0] ?? "all";
  const session = await loadSession();
  if (!session) {
    printErr(`not logged in — run \`brake login\` first, then visit ${getServerUrl()}/ to subscribe.`);
    exit(1);
  }
  const lic = await loadLicense();
  if (!lic) {
    printErr(`no active license. Visit ${getServerUrl()}/ to subscribe.`);
    exit(1);
  }
  if (lic.expiresAt < Date.now()) {
    printErr(`license expired at ${formatExpiry(lic.expiresAt)}. Renew at ${getServerUrl()}/`);
    exit(1);
  }

  const targets: { name: string; hostType: "claude-desktop" | "claude-code" | "chatgpt" }[] = [];
  if (target === "claude-desktop" || target === "all") targets.push({ name: "claude-desktop", hostType: "claude-desktop" });
  if (target === "claude-code" || target === "all") targets.push({ name: "claude-code", hostType: "claude-code" });
  if (target === "chatgpt" || target === "all") targets.push({ name: "chatgpt", hostType: "chatgpt" });
  if (targets.length === 0) {
    printErr(`unknown target '${target}'. Try claude-desktop, claude-code, chatgpt, or all.`);
    exit(2);
  }

  const deviceId = await getDeviceId();
  const deviceMeta = await getDeviceMeta();
  for (const t of targets) {
    try {
      const reg = await callRegisterInstall({
        hostType: t.hostType,
        deviceId,
        hostMeta: { ...deviceMeta, label: `${t.name}@${deviceMeta.hostname}` },
      });
      console.log(`✓ registered ${t.name} (${reg.total}/${reg.limit} connections used)`);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 402) {
        printErr(e.message ?? "connection limit reached");
        exit(1);
      }
      if (e.status === 403) {
        printErr(e.message ?? "no active subscription");
        exit(1);
      }
      printErr(`failed to register ${t.name}: ${e.message ?? String(err)}`);
      exit(1);
    }
  }

  if (target === "claude-desktop") await installClaudeDesktop();
  else if (target === "claude-code") await installClaudeCode();
  else if (target === "chatgpt") await installChatGPT();
  else if (target === "all") await installAll();
  console.log(`✓ brake installed into ${target}.`);
}

async function cmdUninstall(rest: string[]): Promise<void> {
  const target = rest[0] ?? "all";
  const session = await loadSession();
  if (session) {
    try {
      const me = await callListInstalls();
      const deviceId = await getDeviceId();
      for (const i of me.installs) {
        if (i.device_id !== deviceId) continue;
        if (target !== "all" && i.host_type !== target) continue;
        try {
          await callUnregisterInstall(i.id);
        } catch {
          // best effort
        }
      }
    } catch {
      // server unreachable
    }
  }

  if (target === "claude-desktop") await uninstallClaudeDesktop();
  else if (target === "claude-code") await uninstallClaudeCode();
  else if (target === "chatgpt") await uninstallChatGPT();
  else if (target === "all") await uninstallAll();
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
    console.log(`brake v${VERSION}`);
    exit(0);
  }

  const [cmd, ...rest] = args;

  try {
    if (cmd === "login") return await cmdLogin(rest);
    if (cmd === "logout") return await cmdLogout();
    if (cmd === "license") return await cmdLicense(rest);
    if (cmd === "mode") return await cmdMode(rest);
    if (cmd === "connections") return await cmdConnections();
    if (cmd === "metrics") return await cmdMetrics();

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
        exit(0);
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
      await reportUsageBestEffort({ tool: "brake", kind: "engage", calls: 1 });
      if (!result.engaged) exit(2);
      if (!result.withinSla) exit(1);
      exit(0);
    }

    if (cmd === "scan") {
      const intent = rest.join(" ").trim();
      if (!intent) {
        printErr("provide an intent string to scan.");
        exit(2);
      }
      const danger = scanForDanger(intent);
      const cfg = await loadConfig();

      if (danger) {
        await appendAudit(
          {
            event: "danger_blocked",
            intent,
            danger_class: danger.danger,
            evidence: danger.evidence,
            explanation: danger.explanation,
            tokens_saved: danger.tokensSaved,
            dollars_saved: danger.dollarsSaved,
            action_blocked: true,
          },
          cfg.auditPath
        );

        await reportUsageBestEffort({ tool: "brake", kind: "scan", tokens: Math.ceil(intent.length / 4), calls: 1 });
        console.error(JSON.stringify({ matched: true, ...danger }, null, 2));
        exit(1);
      }

      await reportUsageBestEffort({ tool: "brake", kind: "scan", tokens: Math.ceil(intent.length / 4), calls: 1 });
      console.log(JSON.stringify({ danger: false }, null, 2));
      exit(0);
    }

    if (cmd === "status") {
      const limit = parseInt(getFlag(rest, "--limit") ?? "20", 10);
      const cfg = await loadConfig();
      const events = await readAudit(limit, cfg.auditPath);
      console.log(JSON.stringify(events, null, 2));
      exit(0);
    }

    if (cmd === "track") {
      const pidStr = rest[0];
      const label = rest[1];
      if (!pidStr || !label) { printErr("usage: brake track <pid> <label>"); exit(2); }
      const pid = parseInt(pidStr, 10);
      if (!Number.isFinite(pid) || pid <= 0) { printErr(`invalid pid: ${pidStr}`); exit(2); }
      const cfg = await loadConfig();
      await trackPid(pid, label, cfg.pidDir);
      console.log(JSON.stringify({ tracked: { pid, label, pidDir: cfg.pidDir } }, null, 2));
      exit(0);
    }

    if (cmd === "untrack") {
      const label = rest[0];
      if (!label) { printErr("usage: brake untrack <label>"); exit(2); }
      const cfg = await loadConfig();
      await untrackPid(label, cfg.pidDir);
      console.log(JSON.stringify({ untracked: { label } }, null, 2));
      exit(0);
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
        server_url: cfg.serverUrl,
      };
      if (existsSync(DEFAULT_CONFIG_PATH)) {
        printErr(`${DEFAULT_CONFIG_PATH} already exists. Edit it directly.`);
        exit(1);
      }
      await fs.writeFile(DEFAULT_CONFIG_PATH, JSON.stringify(example, null, 2) + "\n", "utf-8");
      console.log(`Wrote ${DEFAULT_CONFIG_PATH}`);
      exit(0);
    }

    if (cmd === "install") return await cmdInstall(rest);
    if (cmd === "uninstall") return await cmdUninstall(rest);

    if (cmd === "mcp") {
      await import("./mcp.js");
      return;
    }

    if (cmd === "rules") {
      console.log(JSON.stringify(listDangerRules(), null, 2));
      exit(0);
    }

    printErr(`unknown command '${cmd}'. Run 'brake --help'.`);
    exit(2);
  } catch (err) {
    if (err instanceof Error) {
      printErr(err.message);
      if (process.env.BRAKE_DEBUG) console.error(err.stack);
    } else {
      printErr(String(err));
    }
    exit(1);
  }
}

main();
