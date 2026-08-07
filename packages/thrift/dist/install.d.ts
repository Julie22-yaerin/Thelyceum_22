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
export declare const THRIFT_HOME_DIR: string;
export declare const THRIFT_SKILL_DIR: string;
export type HostType = "claude-desktop" | "claude-code" | "chatgpt";
/**
 * Where Claude Desktop keeps its config, per platform.
 *
 * Returns null on an unrecognised platform rather than guessing — writing a
 * config to the wrong path silently does nothing, and the user is left
 * wondering why the tools never appeared.
 */
export declare function claudeDesktopConfigPath(): string | null;
export interface InstallResult {
    host: HostType;
    ok: boolean;
    path?: string;
    note: string;
}
export declare function installClaudeDesktop(): Promise<InstallResult>;
export declare function installClaudeCode(): Promise<InstallResult>;
export declare function installChatGPT(): Promise<InstallResult>;
export declare function installAll(): Promise<InstallResult[]>;
export declare function uninstallClaudeDesktop(): Promise<InstallResult>;
export declare function uninstallClaudeCode(): Promise<InstallResult>;
export declare function uninstallChatGPT(): Promise<InstallResult>;
export declare function uninstallAll(): Promise<InstallResult[]>;
