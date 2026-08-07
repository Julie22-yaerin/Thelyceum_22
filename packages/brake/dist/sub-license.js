/**
 * Subscription license gate — client side.
 *
 * Separate file from the beta gate (beta.ts) so a paid subscription key and
 * a time-boxed beta key can coexist without one overwriting the other.
 * Checked first: a customer who paid should never be blocked because a beta
 * key happens to also be sitting on the same machine.
 *
 * Same fail-open policy as the beta gate for network/server failures — the
 * whole point of local-first tools is that a Lyceum outage doesn't stop
 * someone's agents from running. Only an explicit "no" (invalid/expired)
 * blocks.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const LICENSE_PATH = join(homedir(), ".lyceum", "license.json");
const DEFAULT_SERVER_URL = "https://lyceumserver-production.up.railway.app";
export async function checkSubLicenseGate() {
    if (!existsSync(LICENSE_PATH))
        return { active: false, allowed: true };
    let licenseKey;
    try {
        const parsed = JSON.parse(readFileSync(LICENSE_PATH, "utf-8"));
        licenseKey = parsed.licenseKey;
        if (!licenseKey)
            return { active: false, allowed: true };
    }
    catch {
        return { active: false, allowed: true };
    }
    const serverUrl = process.env.LYCEUM_SERVER_URL ?? DEFAULT_SERVER_URL;
    try {
        const res = await fetch(`${serverUrl}/api/license-pool/validate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ licenseKey }),
            signal: AbortSignal.timeout(5000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.ok) {
            return { active: true, allowed: true };
        }
        const message = json.message ?? "Your license code isn't valid.";
        return {
            active: true,
            allowed: false,
            message: `${message} Get a new code at ${new URL("/web/showroom", "https://thelyceum.site")}.`,
        };
    }
    catch {
        return { active: true, allowed: true, message: "license: couldn't reach the license server, allowing this call" };
    }
}
//# sourceMappingURL=sub-license.js.map