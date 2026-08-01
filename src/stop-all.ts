/**
 * The default `stopAll` implementation.
 *
 * Pulling the brake in a standalone deployment has to do something even when
 * the user has not configured anything. This file is what gets called.
 *
 * Order of operations (each step is best-effort; failures are swallowed so a
 * misconfigured webhook does not prevent the PIDs from getting killed):
 *   1. Kill every PID listed in $BRAKE_PID_DIR (default ~/.brake/pids/*.pid).
 *   2. Run $BRAKE_STOP_SCRIPT if it exists and is executable.
 *   3. POST the brake event to $BRAKE_WEBHOOK_URL if set.
 *   4. Append an audit line to $BRAKE_AUDIT_PATH.
 *
 * The user can override any of these with environment variables, and they
 * can pass their own `stopAll` to `engageBrake` for full control.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrakeStopped } from "./brake.js";
import { appendAudit } from "./audit.js";

const pexecFile = promisify(execFile);

export const DEFAULT_PID_DIR = join(homedir(), ".brake", "pids");
export const DEFAULT_AUDIT_PATH = join(homedir(), ".brake", "audit.log");

export interface StopAllConfig {
  pidDir?: string;
  auditPath?: string;
  webhookUrl?: string;
  stopScript?: string;
}

export function makeStopAll(config: StopAllConfig = {}) {
  return async function stopAll(): Promise<BrakeStopped> {
    const pidDir = config.pidDir ?? process.env.BRAKE_PID_DIR ?? DEFAULT_PID_DIR;
    const auditPath = config.auditPath ?? process.env.BRAKE_AUDIT_PATH ?? DEFAULT_AUDIT_PATH;
    const webhookUrl = config.webhookUrl ?? process.env.BRAKE_WEBHOOK_URL;
    const stopScript = config.stopScript ?? process.env.BRAKE_STOP_SCRIPT;

    const killed: number[] = [];
    const errors: string[] = [];

    // 1. Kill every tracked PID.
    if (existsSync(pidDir)) {
      const files = await fs.readdir(pidDir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".pid")) continue;
        const full = join(pidDir, file);
        const content = await fs.readFile(full, "utf-8").catch(() => "");
        const pid = parseInt(content.trim().split(/\s+/)[0] ?? "", 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        try {
          process.kill(pid, "SIGTERM");
          killed.push(pid);
          // Best-effort cleanup of the pid file so we don't re-kill dead procs.
          await fs.unlink(full).catch(() => {});
        } catch (err) {
          errors.push(`kill ${pid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // 2. Run user-supplied stop script (rollback, k8s scale-down, etc.).
    if (stopScript && existsSync(resolve(stopScript))) {
      try {
        await pexecFile(resolve(stopScript), [], { timeout: 5_000 });
      } catch (err) {
        errors.push(`stopScript: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. Notify the webhook so external systems (k8s, monitoring) can react.
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "brake_engaged",
            timestamp: Date.now(),
            stopped: { agents: killed.length, plans: 0 },
            errors,
          }),
        });
        await res.text().catch(() => {});
      } catch (err) {
        errors.push(`webhook: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 4. Audit line — always last so the others' results are captured.
    await appendAudit(
      {
        event: "brake_engaged",
        timestamp: Date.now(),
        agents_killed: killed,
        pid_dir: pidDir,
        webhook: webhookUrl ?? null,
        stop_script: stopScript ?? null,
        errors,
      },
      auditPath
    );

    return { agents: killed.length, plans: 0 };
  };
}

/**
 * Register a PID as something the brake should kill.
 * Writes a .pid file the next engageBrake call will read and SIGTERM.
 */
export async function trackPid(pid: number, label: string, pidDir?: string): Promise<void> {
  const dir = pidDir ?? process.env.BRAKE_PID_DIR ?? DEFAULT_PID_DIR;
  await fs.mkdir(dir, { recursive: true });
  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64) || "agent";
  const path = join(dir, `${safeLabel}.pid`);
  await fs.writeFile(path, `${pid}\n`, "utf-8");
}

export async function untrackPid(label: string, pidDir?: string): Promise<void> {
  const dir = pidDir ?? process.env.BRAKE_PID_DIR ?? DEFAULT_PID_DIR;
  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 64) || "agent";
  const path = join(dir, `${safeLabel}.pid`);
  await fs.unlink(path).catch(() => {});
}
