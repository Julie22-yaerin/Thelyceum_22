/**
 * The brake mode.
 *
 *   always  — the MCP server's `brake` and `danger_scan` tools are described
 *             as "call proactively". The model pulls the brake on its own
 *             when it sees danger. No slash required.
 *   slash   — the MCP server's `brake` tool is described as "only call when
 *             the user explicitly types /brake". The user is in control.
 *             `danger_scan` still runs as a warning but does not auto-engage.
 *
 * Mode is per-install and stored in `~/.brake/config.json`. Changing it
 * requires the host (Claude Desktop / Claude Code) to restart the MCP
 * server, since tool descriptions are baked in at startup.
 */
export type BrakeMode = "always" | "slash";
export declare const VALID_MODES: BrakeMode[];
export declare function configPath(): string;
export declare function loadConfigFile(): Promise<Record<string, unknown>>;
export declare function saveConfigFile(obj: Record<string, unknown>): Promise<void>;
export declare function isValidMode(s: string): s is BrakeMode;
export declare function getMode(): Promise<BrakeMode>;
export declare function setMode(mode: BrakeMode): Promise<void>;
/** Returns the MCP tool description for the `brake` tool in the given mode. */
export declare function brakeDescriptionFor(mode: BrakeMode): string;
export declare function dangerScanDescriptionFor(mode: BrakeMode): string;
//# sourceMappingURL=mode.d.ts.map