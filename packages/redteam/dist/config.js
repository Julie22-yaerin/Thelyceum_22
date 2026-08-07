/**
 * Configuration loaded from env vars and an optional config file at
 * ~/.redteam/config.json. Pure: returns the resolved values without side
 * effects, so both the CLI and the MCP server can use the same loader.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { FLAW_CLASSES } from "./challenge.js";
export const REDTEAM_HOME = join(homedir(), ".redteam");
export const DEFAULT_CONFIG_PATH = join(REDTEAM_HOME, "config.json");
/** The rule-defined blocking set: flaws that hold the line when matched. */
export const DEFAULT_BLOCK_ON = new Set(["unsupported_claim", "confirmation_bias"]);
/** Parses an array or comma-separated string of flaw classes. Null when nothing valid was given. */
function parseBlockOn(raw) {
    const list = Array.isArray(raw)
        ? raw.map((v) => String(v))
        : typeof raw === "string"
            ? raw.split(",").map((s) => s.trim()).filter(Boolean)
            : null;
    if (list === null)
        return null;
    const valid = list.filter((s) => FLAW_CLASSES.includes(s));
    if (valid.length === 0)
        return null;
    return new Set(valid);
}
export function getClaudeDesktopConfigPath() {
    const home = homedir();
    switch (process.platform) {
        case "darwin":
            return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
        case "win32": {
            const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
            return join(appData, "Claude", "claude_desktop_config.json");
        }
        case "linux":
        default:
            return join(home, ".config", "Claude", "claude_desktop_config.json");
    }
}
export async function loadConfig(path = DEFAULT_CONFIG_PATH) {
    let file = {};
    if (existsSync(path)) {
        try {
            file = JSON.parse(await fs.readFile(path, "utf-8"));
        }
        catch {
            // Corrupt config file should not break the red team. Use defaults.
        }
    }
    const blockOn = parseBlockOn(process.env.REDTEAM_BLOCK_ON) ??
        parseBlockOn(file.block_on) ??
        DEFAULT_BLOCK_ON;
    return {
        auditPath: resolve(process.env.REDTEAM_AUDIT_PATH ?? file.audit_path ?? join(REDTEAM_HOME, "audit.log")),
        webhookUrl: process.env.REDTEAM_WEBHOOK_URL ?? file.webhook_url,
        blockOn,
        claudeDesktopPath: resolve(process.env.REDTEAM_CLAUDE_DESKTOP_PATH ??
            file.claude_desktop_path ??
            getClaudeDesktopConfigPath()),
        claudeCodeSettingsPath: resolve(process.env.REDTEAM_CLAUDE_CODE_SETTINGS_PATH ??
            file.claude_code_settings_path ??
            join(homedir(), ".claude", "settings.json")),
        mcpCommand: process.env.REDTEAM_MCP_COMMAND ?? file.mcp_command ?? "redteam",
        mcpArgs: file.mcp_args ?? ["mcp"],
        mcpEnv: file.mcp_env,
    };
}
//# sourceMappingURL=config.js.map