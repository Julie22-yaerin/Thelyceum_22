/**
 * Install the brake into a host.
 *
 * "Always-on without slash" works because the brake ends up in the host's
 * tool/hook list with a description strong enough to fire on its own. This
 * file is what `brake install <target>` calls to wire it up.
 *
 *   claude-desktop   Adds an MCP server entry to claude_desktop_config.json
 *                    with `brake` and `danger_scan` tools auto-loaded.
 *   claude-code      Adds a PreToolUse hook on Bash that calls `brake scan`
 *                    on every shell command and blocks the action when
 *                    danger matches.
 *   chatgpt          Writes the skill file to ~/.brake/skills/ so the
 *                    ChatGPT Skills API picks it up at next context load.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { appendAudit } from "./audit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const BRAKE_SKILL_DIR = join(homedir(), ".brake", "skills");

/** Resolve the path to the running CLI/MCP binary, so Claude Desktop can launch it. */
function resolveBrakeBin(): string {
  // If the user installed globally with `npm i -g`, `brake` is on PATH.
  // If they are running from the source tree, we register `node` + the dist path.
  // We pick the safest option: register `brake` and let the user's PATH decide.
  return "brake";
}

async function readJsonSafe<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(await fs.readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonSafe(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

export async function installClaudeDesktop(): Promise<void> {
  const cfg = await loadConfig();
  const configPath = cfg.claudeDesktopPath;

  const desktop = await readJsonSafe<{ mcpServers?: Record<string, unknown> }>(configPath, {});
  desktop.mcpServers = desktop.mcpServers ?? {};
  desktop.mcpServers.brake = {
    command: resolveBrakeBin(),
    args: ["mcp"],
    env: {
      BRAKE_SLA_MS: String(cfg.slaMs),
      BRAKE_PID_DIR: cfg.pidDir,
      BRAKE_AUDIT_PATH: cfg.auditPath,
      ...(cfg.webhookUrl ? { BRAKE_WEBHOOK_URL: cfg.webhookUrl } : {}),
      ...(cfg.stopScript ? { BRAKE_STOP_SCRIPT: cfg.stopScript } : {}),
    },
  };
  await writeJsonSafe(configPath, desktop);

  await appendAudit({
    event: "install",
    target: "claude-desktop",
    config_path: configPath,
    timestamp: Date.now(),
  }, cfg.auditPath);
}

export async function installClaudeCode(): Promise<void> {
  const cfg = await loadConfig();
  const settingsPath = cfg.claudeCodeSettingsPath;

  // PreToolUse hook on Bash: pipe the command into `brake scan`. If it
  // matches a danger pattern, exit 2 to block the action with the
  // explanation shown to the model.
  const hookCommand = `brake scan "$CLAUDE_TOOL_INPUT" 1>&2; if [ $? -eq 1 ]; then echo 'BRAKE: action blocked — match in $CLAUDE_TOOL_INPUT. Run brake status for the audit log. Confirm with the user before retrying.' 1>&2; exit 2; fi`;

  const settings = await readJsonSafe<{ hooks?: { PreToolUse?: unknown[] } }>(settingsPath, {});
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse ?? [];

  const existing = settings.hooks.PreToolUse;
  const alreadyInstalled = existing.some((h: any) =>
    Array.isArray(h?.hooks) && h.hooks.some((hh: any) => typeof hh?.command === "string" && hh.command.includes("brake scan"))
  );

  if (!alreadyInstalled) {
    existing.push({
      matcher: "Bash",
      hooks: [{ type: "command", command: hookCommand }],
    });
  }
  await writeJsonSafe(settingsPath, settings);

  await appendAudit({
    event: "install",
    target: "claude-code",
    config_path: settingsPath,
    timestamp: Date.now(),
  }, cfg.auditPath);
}

export async function installChatGPT(): Promise<void> {
  const cfg = await loadConfig();
  await fs.mkdir(BRAKE_SKILL_DIR, { recursive: true });

  // Locate the bundled skill file shipped with the package.
  const skillSource = resolve(__dirname, "..", "skills", "brake", "SKILL.md");
  let content: string;
  if (existsSync(skillSource)) {
    content = await fs.readFile(skillSource, "utf-8");
  } else {
    // Fallback: synthesize a minimal skill so install still works.
    content = [
      "# Brake",
      "",
      "Stop everything when danger is detected. The model should call this",
      "proactively — the user does not have to say /brake or mention it by name.",
      "",
      "Tools: `brake`, `danger_scan`, `brake_status`.",
    ].join("\n");
  }

  const target = join(BRAKE_SKILL_DIR, "brake.md");
  await fs.writeFile(target, content, "utf-8");

  await appendAudit({
    event: "install",
    target: "chatgpt",
    skill_path: target,
    timestamp: Date.now(),
  }, cfg.auditPath);
}

export async function installAll(): Promise<void> {
  await installClaudeDesktop();
  await installClaudeCode();
  await installChatGPT();
}

export async function uninstallClaudeDesktop(): Promise<void> {
  const cfg = await loadConfig();
  const configPath = cfg.claudeDesktopPath;
  const desktop = await readJsonSafe<{ mcpServers?: Record<string, unknown> }>(configPath, {});
  if (desktop.mcpServers?.brake) {
    delete desktop.mcpServers.brake;
    await writeJsonSafe(configPath, desktop);
  }
}

export async function uninstallClaudeCode(): Promise<void> {
  const cfg = await loadConfig();
  const settingsPath = cfg.claudeCodeSettingsPath;
  const settings = await readJsonSafe<{ hooks?: { PreToolUse?: unknown[] } }>(settingsPath, {});
  if (settings.hooks?.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
      (h: any) => !(Array.isArray(h?.hooks) && h.hooks.some((hh: any) => typeof hh?.command === "string" && hh.command.includes("brake scan")))
    );
    await writeJsonSafe(settingsPath, settings);
  }
}

export async function uninstallChatGPT(): Promise<void> {
  await fs.unlink(join(BRAKE_SKILL_DIR, "brake.md")).catch(() => {});
}

export async function uninstallAll(): Promise<void> {
  await uninstallClaudeDesktop();
  await uninstallClaudeCode();
  await uninstallChatGPT();
}
