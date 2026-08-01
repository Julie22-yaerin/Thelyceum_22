/**
 * Install the red team into a host.
 *
 * Same wiring as the brake, so the setup flow is identical:
 *
 *   claude-desktop   Adds an MCP server entry to claude_desktop_config.json
 *                    with `challenge` and `rebut` tools auto-loaded.
 *   claude-code      Adds a PreToolUse hook on Write/Edit that pipes the
 *                    proposed change into `redteam challenge -` and blocks
 *                    the write when the verdict is blocked.
 *   chatgpt          Writes the skill file to ~/.redteam/skills/ so the
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

export const REDTEAM_SKILL_DIR = join(homedir(), ".redteam", "skills");

/** Resolve the path to the running CLI binary, so Claude Desktop can launch it. */
function resolveRedteamBin(): string {
  // If the user installed globally with `npm i -g`, `redteam` is on PATH.
  // We pick the safest option: register `redteam` and let the user's PATH decide.
  return "redteam";
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
  desktop.mcpServers.redteam = {
    command: resolveRedteamBin(),
    args: ["mcp"],
    env: {
      REDTEAM_AUDIT_PATH: cfg.auditPath,
      ...(cfg.webhookUrl ? { REDTEAM_WEBHOOK_URL: cfg.webhookUrl } : {}),
      ...(cfg.blockOn ? { REDTEAM_BLOCK_ON: [...cfg.blockOn].join(",") } : {}),
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

  // PreToolUse hook on Write/Edit: pipe the proposed change into
  // `redteam challenge -`. If the verdict is blocked, exit 2 to block the
  // write with the explanation shown to the model.
  const hookCommand = `echo "$CLAUDE_TOOL_INPUT" | redteam challenge - 1>&2; if [ $? -eq 1 ]; then echo 'REDTEAM: one-sided reasoning detected in proposed change — challenge output above. Confirm the reasoning before retrying.' 1>&2; exit 2; fi`;

  const settings = await readJsonSafe<{ hooks?: { PreToolUse?: unknown[] } }>(settingsPath, {});
  settings.hooks = settings.hooks ?? {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse ?? [];

  const existing = settings.hooks.PreToolUse;
  const alreadyInstalled = existing.some((h: any) =>
    Array.isArray(h?.hooks) && h.hooks.some((hh: any) => typeof hh?.command === "string" && hh.command.includes("redteam challenge"))
  );

  if (!alreadyInstalled) {
    existing.push({
      matcher: "Write|Edit",
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
  await fs.mkdir(REDTEAM_SKILL_DIR, { recursive: true });

  // Locate the bundled skill file shipped with the package.
  const skillSource = resolve(__dirname, "..", "skills", "redteam", "SKILL.md");
  let content: string;
  if (existsSync(skillSource)) {
    content = await fs.readFile(skillSource, "utf-8");
  } else {
    // Fallback: synthesize a minimal skill so install still works.
    content = [
      "# Red Team",
      "",
      "Attack one-sided reasoning before it ships. The model should call this",
      "proactively — it challenges its own conclusion even when the user did not",
      "ask. Tools: `challenge`, `rebut`, `redteam_status`.",
    ].join("\n");
  }

  const target = join(REDTEAM_SKILL_DIR, "redteam.md");
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
  if (desktop.mcpServers?.redteam) {
    delete desktop.mcpServers.redteam;
    await writeJsonSafe(configPath, desktop);
  }
}

export async function uninstallClaudeCode(): Promise<void> {
  const cfg = await loadConfig();
  const settingsPath = cfg.claudeCodeSettingsPath;
  const settings = await readJsonSafe<{ hooks?: { PreToolUse?: unknown[] } }>(settingsPath, {});
  if (settings.hooks?.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
      (h: any) => !(Array.isArray(h?.hooks) && h.hooks.some((hh: any) => typeof hh?.command === "string" && hh.command.includes("redteam challenge")))
    );
    await writeJsonSafe(settingsPath, settings);
  }
}

export async function uninstallChatGPT(): Promise<void> {
  await fs.unlink(join(REDTEAM_SKILL_DIR, "redteam.md")).catch(() => {});
}

export async function uninstallAll(): Promise<void> {
  await uninstallClaudeDesktop();
  await uninstallClaudeCode();
  await uninstallChatGPT();
}
