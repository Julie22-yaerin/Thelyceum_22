/**
 * Best-effort usage reporting for the budget dashboard.
 *
 * All three tools share one Lyceum subscription, and the session that proves
 * it is written by `brake login` (~/.brake/session.json). redteam has no
 * login of its own — it reuses that session, exactly as it reuses the same
 * license server. Without a session there is nothing to attribute usage to,
 * so the report is skipped entirely.
 *
 * Never blocks and never fails the tool: the caller races this against a
 * short timeout, and every error is swallowed. A usage report is a number on
 * a dashboard, not a checkpoint on the hot path.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TARGET } from "./variant.js";

export interface UsageReportInput {
  tool: "brake" | "redteam" | "thrift";
  kind: string;
  tokens?: number;
  calls?: number;
}

const BRAKE_HOME = join(homedir(), ".brake");
const SESSION_PATH = join(BRAKE_HOME, "session.json");
const BRAKE_CONFIG_PATH = join(BRAKE_HOME, "config.json");

/** Server URL: explicit env wins, else the brake config's server_url, else the default. */
function serverUrl(): string {
  const env = process.env.LYCEUM_SERVER_URL ?? process.env.BRAKE_SERVER_URL;
  if (env) return env;
  try {
    if (existsSync(BRAKE_CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(BRAKE_CONFIG_PATH, "utf-8")) as { server_url?: string };
      if (cfg.server_url) return cfg.server_url;
    }
  } catch {
    // corrupt config — fall through to the default
  }
  return "https://brake.example";
}

/**
 * Post one usage report. Resolves when sent or timed out — never rejects
 * with a server problem. Races an internal timeout so a hanging server
 * cannot hang the CLI.
 */
export async function reportUsageBestEffort(input: UsageReportInput): Promise<void> {
  if (TARGET === "local-full" || TARGET === "local-trial") return;
  try {
    if (!existsSync(SESSION_PATH)) return;
    const session = JSON.parse(readFileSync(SESSION_PATH, "utf-8")) as { token?: string };
    if (!session.token) return;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 150);
    try {
      await fetch(new URL("/api/usage/report", serverUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify(input),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // best effort — the audit line already captured what happened locally
  }
}
