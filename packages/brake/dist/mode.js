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
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { BRAKE_HOME } from "./config.js";
export const VALID_MODES = ["always", "slash"];
const CONFIG_PATH = join(BRAKE_HOME, "config.json");
export function configPath() { return CONFIG_PATH; }
export async function loadConfigFile() {
    if (!existsSync(CONFIG_PATH))
        return {};
    try {
        const raw = await fs.readFile(CONFIG_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
export async function saveConfigFile(obj) {
    await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}
export function isValidMode(s) {
    return VALID_MODES.includes(s);
}
export async function getMode() {
    const cfg = await loadConfigFile();
    const m = cfg.mode;
    return isValidMode(typeof m === "string" ? m : "") ? m : "always";
}
export async function setMode(mode) {
    if (!isValidMode(mode))
        throw new Error(`invalid mode: ${mode}`);
    const cfg = await loadConfigFile();
    cfg.mode = mode;
    await saveConfigFile(cfg);
}
/** Returns the MCP tool description for the `brake` tool in the given mode. */
export function brakeDescriptionFor(mode) {
    if (mode === "always") {
        return [
            "Pull the emergency brake. Stops every PID registered with `brake track`,",
            "runs the configured stop script, posts to the webhook if set, and writes",
            "an audit line. The SLA is 1000ms; a brake that quietly ran slow is reported",
            "as over-SLA rather than hidden.",
            "",
            "Call this when the model itself judges the situation dangerous, NOT only",
            "when the user says 'brake' or types /brake. The user is informed afterwards,",
            "not asked beforehand. A brake that asks permission is not a brake.",
            "",
            "Trigger conditions (any one is enough):",
            "- Intent matches a danger pattern: data exfiltration, infrastructure attack,",
            "  credential access, destructive operation, financial movement, impersonation.",
            "- The user says 'stop', 'halt', 'panic', 'abort', 'kill it', 'đợi', 'dừng'.",
            "- The agent is about to do something irreversible without explicit consent.",
            "- The model would not be able to undo the action in 5 seconds.",
        ].join(" ");
    }
    // slash mode
    return [
        "Pull the emergency brake. Stops every PID registered with `brake track`,",
        "runs the configured stop script, posts to the webhook if set, and writes",
        "an audit line. The SLA is 1000ms; a brake that quietly ran slow is reported",
        "as over-SLA rather than hidden.",
        "",
        "STRICT MODE: ONLY call this when the user explicitly types /brake, or types",
        "an explicit stop command like 'stop', 'halt', 'panic', 'abort', 'kill it',",
        "'đợi', 'dừng lại'. Do NOT auto-fire based on the model's own judgement of",
        "the situation. In strict mode, the user is in control. If you would normally",
        "call this, surface the danger to the user instead and let them decide.",
    ].join(" ");
}
export function dangerScanDescriptionFor(mode) {
    if (mode === "always") {
        return [
            "Scan a planned action for danger before executing. Returns the matched",
            "danger class, evidence, and explanation if the intent matches a red-alert",
            "rule. Use this proactively before any action that touches data, credentials,",
            "networks, or money. The model should call this itself when it judges an",
            "action might be dangerous — the user does not have to ask.",
            "",
            "Rules watched: data_exfiltration, infrastructure_attack, credential_access,",
            "destructive_operation, financial_movement, impersonation. Patterns are",
            "deliberately narrow to keep false positives rare.",
        ].join(" ");
    }
    // slash mode
    return [
        "Scan a planned action for danger before executing. Returns the matched",
        "danger class, evidence, and explanation if the intent matches a red-alert",
        "rule.",
        "",
        "STRICT MODE: Only call this when the user asks. Do not run it proactively.",
        "If you would normally run this, mention the matched risk to the user in",
        "your reply instead.",
    ].join(" ");
}
//# sourceMappingURL=mode.js.map