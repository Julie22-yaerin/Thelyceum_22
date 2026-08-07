/**
 * Device identity.
 *
 * A device id is a stable string that uniquely identifies one machine
 * for license-connection counting. It is generated once on first use and
 * stored in `~/.brake/device-id`. The id is NOT a fingerprint of the
 * machine — it is random — but it is stable across `brake` invocations
 * on the same machine so that re-installing the same host does not count
 * as a new connection.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { BRAKE_HOME } from "./config.js";
const DEVICE_ID_PATH = join(BRAKE_HOME, "device-id");
export function deviceIdPath() { return DEVICE_ID_PATH; }
export async function getDeviceId() {
    if (existsSync(DEVICE_ID_PATH)) {
        try {
            const v = (await fs.readFile(DEVICE_ID_PATH, "utf-8")).trim();
            if (v.length > 0)
                return v;
        }
        catch {
            // fall through to generate
        }
    }
    const id = randomBytes(16).toString("hex");
    await fs.mkdir(dirname(DEVICE_ID_PATH), { recursive: true });
    await fs.writeFile(DEVICE_ID_PATH, id + "\n", "utf-8");
    return id;
}
/** Human-friendly label, mainly for `brake connections` output. */
export function deviceLabel() {
    const host = process.env.HOSTNAME ?? "unknown";
    const user = process.env.USER ?? process.env.USERNAME ?? "user";
    return `${user}@${host}`;
}
export async function getDeviceMeta() {
    return {
        hostname: process.env.HOSTNAME ?? "unknown",
        user: process.env.USER ?? process.env.USERNAME ?? "user",
        homedir: homedir(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
    };
}
//# sourceMappingURL=device.js.map