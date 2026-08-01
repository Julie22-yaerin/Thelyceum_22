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

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { REDTEAM_HOME } from "./config.js";

export type RedteamMode = "always" | "slash";
export const VALID_MODES: RedteamMode[] = ["always", "slash"];

const CONFIG_PATH = join(REDTEAM_HOME, "config.json");

export function configPath(): string { return CONFIG_PATH; }

export async function loadConfigFile(): Promise<Record<string, unknown>> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function saveConfigFile(obj: Record<string, unknown>): Promise<void> {
  await fs.mkdir(dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

export function isValidMode(s: string): s is RedteamMode {
  return (VALID_MODES as string[]).includes(s);
}

export async function getMode(): Promise<RedteamMode> {
  const cfg = await loadConfigFile();
  const m = cfg.mode;
  return isValidMode(typeof m === "string" ? m : "") ? (m as RedteamMode) : "always";
}

export async function setMode(mode: RedteamMode): Promise<void> {
  if (!isValidMode(mode)) throw new Error(`invalid mode: ${mode}`);
  const cfg = await loadConfigFile();
  cfg.mode = mode;
  await saveConfigFile(cfg);
}

/** Returns the MCP tool description for the `challenge` tool in the given mode. */
export function challengeDescriptionFor(mode: RedteamMode): string {
  if (mode === "always") {
    return [
      "Challenge a claim, plan, or piece of reasoning before it is presented as settled.",
      "Returns the red flags found (overconfidence, unsupported claims, confirmation bias,",
      "false dichotomies, missing trade-offs, straw men, anecdote-as-evidence, slippery slopes,",
      "unchecked assumptions) and counter-questions that steelman the other side.",
      "",
      "Call this proactively — NOT only when the user asks. The model is the red team:",
      "attack your own conclusion before you present it. When the reasoning is one-sided,",
      "when a claim is certain-sounding, when a plan has no stated downside, or when a",
      "recommendation is about to ship without a trade-off, call challenge on it first.",
      "The user is shown the rebuttal, not asked to request one.",
    ].join(" ");
  }
  // slash mode
  return [
    "Challenge a claim, plan, or piece of reasoning. Returns red flags and",
    "counter-arguments that steelman the other side.",
    "",
    "STRICT MODE: ONLY call this when the user explicitly asks, types /redteam,",
    "or says 'phản biện' / 'devil's advocate' / 'challenge my reasoning' / 'kiểm tra",
    "lập luận'. Do NOT run it proactively. If you would normally call this, briefly",
    "note the risk you see in your reply and let the user decide.",
  ].join(" ");
}

/** Returns the MCP tool description for the `rebut` tool in the given mode. */
export function rebutDescriptionFor(mode: RedteamMode): string {
  if (mode === "always") {
    return [
      "Quick devil's advocate. Given a claim or plan, returns the counter-arguments and",
      "a verdict without the full flag audit. Cheap; call it before answering any",
      "'which is better' / 'should we' / 'is this right' question, even if the user did",
      "not ask for it. The red team's job is to test the conclusion before it ships.",
    ].join(" ");
  }
  return [
    "Quick devil's advocate: returns counter-arguments and a verdict for a claim or plan.",
    "",
    "STRICT MODE: ONLY call this when the user explicitly asks for it. Do not run",
    "proactively. Note the risk in your reply and let the user decide.",
  ].join(" ");
}
