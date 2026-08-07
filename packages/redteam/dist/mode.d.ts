/**
 * The red team mode.
 *
 *   always  — the MCP server's `challenge` and `rebut` tools are described
 *             as "call proactively". The model challenges its own reasoning
 *             on its own, without the user asking. This is the whole point
 *             of the red team: the model attacks its own conclusion before
 *             it presents it.
 *   slash   — the MCP server's tools are described as "only call when the
 *             user explicitly types /redteam or asks for a devil's advocate".
 *             The user is in control.
 *
 * Mode is per-install and stored in `~/.redteam/config.json`. Changing it
 * requires the host (Claude Desktop / Claude Code) to restart the MCP
 * server, since tool descriptions are baked in at startup.
 */
export type RedteamMode = "always" | "slash";
export declare const VALID_MODES: RedteamMode[];
export declare function configPath(): string;
export declare function loadConfigFile(): Promise<Record<string, unknown>>;
export declare function saveConfigFile(obj: Record<string, unknown>): Promise<void>;
export declare function isValidMode(s: string): s is RedteamMode;
export declare function getMode(): Promise<RedteamMode>;
export declare function setMode(mode: RedteamMode): Promise<void>;
/** Returns the MCP tool description for the `challenge` tool in the given mode. */
export declare function challengeDescriptionFor(mode: RedteamMode): string;
/** Returns the MCP tool description for the `rebut` tool in the given mode. */
export declare function rebutDescriptionFor(mode: RedteamMode): string;
//# sourceMappingURL=mode.d.ts.map