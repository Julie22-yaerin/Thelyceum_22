/**
 * Install thrift into a host.
 *
 * ── How this differs from brake's installer, and why ────────────────────────
 * brake registers a PreToolUse HOOK: it gates every Bash command and blocks
 * dangerous ones, so it has to sit in front of the host's own tools. thrift is
 * not a gate — it is an ALTERNATIVE to the host's file-read and shell tools.
 * A hook that intercepted every read to compress it would break byte-exact
 * reads (writing a file back out, checksumming) with no way for the model to
 * opt out.
 *
 * So thrift registers only as an MCP server plus a skill. The model chooses
 * `read_lean` over the host's read because the skill description tells it
 * when that pays, and keeps the normal read for when it needs exact bytes.
 * That choice has to stay available.
 *
 *   claude-desktop   MCP server entry in claude_desktop_config.json
 *   claude-code      MCP server entry in ~/.claude/settings.json
 *   chatgpt          Skill file in ~/.thrift/skills/
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const THRIFT_HOME_DIR = join(homedir(), ".thrift");
export const THRIFT_SKILL_DIR = join(THRIFT_HOME_DIR, "skills");
/**
 * Where Claude Desktop keeps its config, per platform.
 *
 * Returns null on an unrecognised platform rather than guessing — writing a
 * config to the wrong path silently does nothing, and the user is left
 * wondering why the tools never appeared.
 */
export function claudeDesktopConfigPath() {
    const home = homedir();
    switch (platform()) {
        case "darwin":
            return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
        case "win32":
            return process.env.APPDATA
                ? join(process.env.APPDATA, "Claude", "claude_desktop_config.json")
                : null;
        case "linux":
            return join(home, ".config", "Claude", "claude_desktop_config.json");
        default:
            return null;
    }
}
async function readJsonSafe(path, fallback) {
    if (!existsSync(path))
        return fallback;
    try {
        return JSON.parse(await fs.readFile(path, "utf-8"));
    }
    catch {
        // A malformed config is not ours to repair — callers check existsSync
        // before deciding, so an unparseable file is refused rather than
        // silently replaced.
        return fallback;
    }
}
async function writeJsonSafe(path, value) {
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}
/**
 * The command a host should run to start thrift's MCP server.
 *
 * Prefers the absolute path to the built entry point in this checkout, so a
 * source-tree install works without `npm link`. Falls back to a bare command
 * name for a global install.
 */
function mcpCommand() {
    const localEntry = resolve(__dirname, "mcp.js");
    if (existsSync(localEntry))
        return { command: process.execPath, args: [localEntry] };
    return { command: "thrift-mcp", args: [] };
}
export async function installClaudeDesktop() {
    const path = claudeDesktopConfigPath();
    if (!path) {
        return { host: "claude-desktop", ok: false, note: `Unsupported platform: ${platform()}` };
    }
    const existed = existsSync(path);
    const config = await readJsonSafe(path, {});
    if (existed && Object.keys(config).length === 0) {
        return {
            host: "claude-desktop",
            ok: false,
            path,
            note: "Config exists but could not be parsed. Refusing to overwrite it — fix the JSON and re-run.",
        };
    }
    const { command, args } = mcpCommand();
    config.mcpServers = config.mcpServers ?? {};
    config.mcpServers.thrift = { command, args };
    await writeJsonSafe(path, config);
    return {
        host: "claude-desktop",
        ok: true,
        path,
        note: "Restart Claude Desktop — MCP tools load at session start.",
    };
}
export async function installClaudeCode() {
    const path = join(homedir(), ".claude", "settings.json");
    const existed = existsSync(path);
    const settings = await readJsonSafe(path, {});
    if (existed && Object.keys(settings).length === 0) {
        return {
            host: "claude-code",
            ok: false,
            path,
            note: "settings.json exists but could not be parsed. Refusing to overwrite it.",
        };
    }
    const { command, args } = mcpCommand();
    settings.mcpServers = settings.mcpServers ?? {};
    settings.mcpServers.thrift = { command, args };
    await writeJsonSafe(path, settings);
    return {
        host: "claude-code",
        ok: true,
        path,
        note: "Restart Claude Code to pick up the new tools.",
    };
}
export async function installChatGPT() {
    const source = resolve(__dirname, "..", "skills", "thrift", "SKILL.md");
    if (!existsSync(source)) {
        return { host: "chatgpt", ok: false, note: `Skill file not found at ${source}` };
    }
    const dest = join(THRIFT_SKILL_DIR, "thrift", "SKILL.md");
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.copyFile(source, dest);
    return { host: "chatgpt", ok: true, path: dest, note: "Loaded on the next context." };
}
export async function installAll() {
    return [await installClaudeDesktop(), await installClaudeCode(), await installChatGPT()];
}
async function removeMcpEntry(path, host) {
    if (!existsSync(path))
        return { host, ok: true, path, note: "Nothing installed." };
    const config = await readJsonSafe(path, {});
    if (!config.mcpServers?.thrift)
        return { host, ok: true, path, note: "Nothing installed." };
    delete config.mcpServers.thrift;
    await writeJsonSafe(path, config);
    return { host, ok: true, path, note: "Removed. Restart the host." };
}
export async function uninstallClaudeDesktop() {
    const path = claudeDesktopConfigPath();
    if (!path)
        return { host: "claude-desktop", ok: false, note: `Unsupported platform: ${platform()}` };
    return removeMcpEntry(path, "claude-desktop");
}
export async function uninstallClaudeCode() {
    return removeMcpEntry(join(homedir(), ".claude", "settings.json"), "claude-code");
}
export async function uninstallChatGPT() {
    const dest = join(THRIFT_SKILL_DIR, "thrift", "SKILL.md");
    await fs.rm(dest, { force: true });
    return { host: "chatgpt", ok: true, path: dest, note: "Skill removed." };
}
export async function uninstallAll() {
    return [await uninstallClaudeDesktop(), await uninstallClaudeCode(), await uninstallChatGPT()];
}
//# sourceMappingURL=install.js.map