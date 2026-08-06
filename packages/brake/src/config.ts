/**
 * Configuration loaded from env vars and an optional config file at
 * ~/.brake/config.json. Pure: returns the resolved values without side
 * effects, so both the CLI and the MCP server can use the same loader.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export const BRAKE_HOME = join(homedir(), ".brake");
export const DEFAULT_CONFIG_PATH = join(BRAKE_HOME, "config.json");

export interface BrakeConfigFile {
  sla_ms?: number;
  pid_dir?: string;
  audit_path?: string;
  webhook_url?: string;
  stop_script?: string;
  claude_desktop_path?: string;
  claude_code_settings_path?: string;
  /** Server URL for license + install registration. Default https://brake.example. */
  server_url?: string;
}

export interface ResolvedConfig {
  slaMs: number;
  pidDir: string;
  auditPath: string;
  webhookUrl?: string;
  stopScript?: string;
  claudeDesktopPath: string;
  claudeCodeSettingsPath: string;
  serverUrl: string;
}

function defaultClaudeDesktopPath(): string {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return process.env.APPDATA
        ? join(process.env.APPDATA, "Claude", "claude_desktop_config.json")
        : join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
    case "linux":
      return join(home, ".config", "Claude", "claude_desktop_config.json");
    default:
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
}

export async function loadConfig(path: string = DEFAULT_CONFIG_PATH): Promise<ResolvedConfig> {
  let file: BrakeConfigFile = {};
  if (existsSync(path)) {
    try {
      file = JSON.parse(await fs.readFile(path, "utf-8")) as BrakeConfigFile;
    } catch {
      // Corrupt config file should not break the brake. Use defaults.
    }
  }

  return {
    slaMs: Number(process.env.BRAKE_SLA_MS ?? file.sla_ms ?? 1000),
    pidDir: resolve(process.env.BRAKE_PID_DIR ?? file.pid_dir ?? join(BRAKE_HOME, "pids")),
    auditPath: resolve(process.env.BRAKE_AUDIT_PATH ?? file.audit_path ?? join(BRAKE_HOME, "audit.log")),
    webhookUrl: process.env.BRAKE_WEBHOOK_URL ?? file.webhook_url,
    stopScript: process.env.BRAKE_STOP_SCRIPT ?? file.stop_script,
    claudeDesktopPath: resolve(
      process.env.BRAKE_CLAUDE_DESKTOP_PATH ??
        file.claude_desktop_path ??
        defaultClaudeDesktopPath()
    ),
    claudeCodeSettingsPath: resolve(
      process.env.BRAKE_CLAUDE_CODE_SETTINGS_PATH ??
        file.claude_code_settings_path ??
        join(homedir(), ".claude", "settings.json")
    ),
    serverUrl: process.env.BRAKE_SERVER_URL ?? file.server_url ?? "https://brake.example",
  };
}
