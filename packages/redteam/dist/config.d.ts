/**
 * Configuration loaded from env vars and an optional config file at
 * ~/.redteam/config.json. Pure: returns the resolved values without side
 * effects, so both the CLI and the MCP server can use the same loader.
 */
import { type FlawClass } from "./challenge.js";
export declare const REDTEAM_HOME: string;
export declare const DEFAULT_CONFIG_PATH: string;
/** The rule-defined blocking set: flaws that hold the line when matched. */
export declare const DEFAULT_BLOCK_ON: ReadonlySet<FlawClass>;
export interface RedteamConfigFile {
    audit_path?: string;
    webhook_url?: string;
    /** Flaw classes that block (exit 1 / hook block). Defaults to DEFAULT_BLOCK_ON. */
    block_on?: string[];
    claude_desktop_path?: string;
    claude_code_settings_path?: string;
    mcp_command?: string;
    mcp_args?: string[];
    mcp_env?: Record<string, string>;
}
export interface ResolvedConfig {
    auditPath: string;
    webhookUrl?: string;
    blockOn: ReadonlySet<FlawClass>;
    claudeDesktopPath: string;
    claudeCodeSettingsPath: string;
    mcpCommand: string;
    mcpArgs: string[];
    mcpEnv?: Record<string, string>;
}
export declare function getClaudeDesktopConfigPath(): string;
export declare function loadConfig(path?: string): Promise<ResolvedConfig>;
//# sourceMappingURL=config.d.ts.map