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
export declare const BRAKE_SKILL_DIR: string;
export declare function installClaudeDesktop(): Promise<void>;
export declare function installClaudeCode(): Promise<void>;
export declare function installChatGPT(): Promise<void>;
export declare function installAll(): Promise<void>;
export declare function uninstallClaudeDesktop(): Promise<void>;
export declare function uninstallClaudeCode(): Promise<void>;
export declare function uninstallChatGPT(): Promise<void>;
export declare function uninstallAll(): Promise<void>;
//# sourceMappingURL=install.d.ts.map