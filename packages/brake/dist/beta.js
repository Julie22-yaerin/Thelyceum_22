/**
 * Beta trial gate — client side.
 *
 * Opt-in: if `~/.lyceum/beta-license.json` doesn't exist, every check here
 * is a no-op (`active: false, allowed: true`) and the tool behaves exactly
 * as it does for a normal dev/paid install. The gate only engages for
 * someone who was handed a beta key and ran the activation script.
 *
 * Network/server failure fails OPEN, not closed — this caps an evaluation
 * invite as a courtesy, it is not the payment gate (that's license.ts, which
 * fails closed). A Railway hiccup should never brick a beta reviewer's tools.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const BETA_LICENSE_PATH = join(homedir(), ".lyceum", "beta-license.json");
const DEFAULT_SERVER_URL = "https://lyceumserver-production.up.railway.app";
export async function checkBetaGate() {
    if (!existsSync(BETA_LICENSE_PATH))
        return { active: false, allowed: true };
    let licenseKey;
    try {
        const parsed = JSON.parse(readFileSync(BETA_LICENSE_PATH, "utf-8"));
        licenseKey = parsed.licenseKey;
        if (!licenseKey)
            return { active: false, allowed: true };
    }
    catch {
        return { active: false, allowed: true };
    }
    const serverUrl = process.env.LYCEUM_SERVER_URL ?? DEFAULT_SERVER_URL;
    try {
        const res = await fetch(`${serverUrl}/api/beta/check`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ licenseKey }),
            signal: AbortSignal.timeout(5000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
            const j = json;
            return {
                active: true,
                allowed: true,
                message: `beta trial: ${j.usesRemainingToday} use(s) left today, ${j.daysRemaining.toFixed(1)}d remaining`,
            };
        }
        return {
            active: true,
            allowed: false,
            message: json.message ?? "Beta trial check failed.",
        };
    }
    catch {
        return { active: true, allowed: true, message: "beta trial: couldn't reach the license server, allowing this call" };
    }
}
//# sourceMappingURL=beta.js.map