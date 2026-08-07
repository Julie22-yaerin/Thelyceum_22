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
export declare const REDTEAM_SKILL_DIR: string;
export declare function installClaudeDesktop(): Promise<void>;
export declare function installClaudeCode(): Promise<void>;
export declare function installChatGPT(): Promise<void>;
export declare function installAll(): Promise<void>;
export declare function uninstallClaudeDesktop(): Promise<void>;
export declare function uninstallClaudeCode(): Promise<void>;
export declare function uninstallChatGPT(): Promise<void>;
export declare function uninstallAll(): Promise<void>;
//# sourceMappingURL=install.d.ts.map