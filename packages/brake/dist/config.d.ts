/**
 * Configuration loaded from env vars and an optional config file at
 * ~/.brake/config.json. Pure: returns the resolved values without side
 * effects, so both the CLI and the MCP server can use the same loader.
 */
export declare const BRAKE_HOME: string;
export declare const DEFAULT_CONFIG_PATH: string;
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
export declare function getClaudeDesktopConfigPath(): string;
export declare function loadConfig(path?: string): Promise<ResolvedConfig>;
//# sourceMappingURL=config.d.ts.map