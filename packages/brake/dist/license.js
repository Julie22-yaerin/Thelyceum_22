/**
 * License management on the CLI side.
 *
 * The license is a short-lived JWT (30 days) issued by the brake server and
 * stored at `~/.brake/license.json`. The CLI fetches it on `brake login`
 * and refreshes it on demand. Every privileged action (install, MCP startup
 * in license-enforced hosts) re-validates with the server before proceeding.
 *
 * The server URL is configurable via `BRAKE_SERVER_URL` or
 * `~/.brake/config.json`. Default is `https://brake.example` for production.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { BRAKE_HOME } from "./config.js";
const LICENSE_PATH = join(BRAKE_HOME, "license.json");
const SESSION_PATH = join(BRAKE_HOME, "session.json");
const DEFAULT_SERVER_URL = process.env.BRAKE_SERVER_URL ?? "https://brake.example";
export function licensePath() { return LICENSE_PATH; }
export function sessionPath() { return SESSION_PATH; }
export function getServerUrl() {
    // loadConfig is async; for a simple getter we use the env override if
    // present, otherwise fall back to the default. The actual config-file
    // value is read in async serverFetch when needed.
    return process.env.BRAKE_SERVER_URL ?? DEFAULT_SERVER_URL;
}
export async function loadLicense() {
    if (!existsSync(LICENSE_PATH))
        return null;
    try {
        const raw = await fs.readFile(LICENSE_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function saveLicense(lic) {
    await fs.mkdir(dirname(LICENSE_PATH), { recursive: true });
    await fs.writeFile(LICENSE_PATH, JSON.stringify(lic, null, 2) + "\n", "utf-8");
}
export async function clearLicense() {
    await fs.unlink(LICENSE_PATH).catch(() => { });
    await fs.unlink(SESSION_PATH).catch(() => { });
}
export async function loadSession() {
    if (!existsSync(SESSION_PATH))
        return null;
    try {
        const raw = await fs.readFile(SESSION_PATH, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function saveSession(s) {
    await fs.mkdir(dirname(SESSION_PATH), { recursive: true });
    await fs.writeFile(SESSION_PATH, JSON.stringify(s, null, 2) + "\n", "utf-8");
}
async function serverFetch(path, init = {}, requireAuth = true) {
    const url = new URL(path, getServerUrl()).toString();
    const headers = { "Content-Type": "application/json", ...init.headers };
    if (requireAuth) {
        const session = await loadSession();
        if (!session) {
            const e = new Error("not logged in — run `brake login` first");
            e.status = 401;
            throw e;
        }
        headers["Authorization"] = `Bearer ${session.token}`;
    }
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch { }
    if (!res.ok) {
        const e = new Error(extractErrorMessage(json) ?? `server returned ${res.status}`);
        e.status = res.status;
        e.body = json;
        throw e;
    }
    return json;
}
function extractErrorMessage(body) {
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
        return body.message;
    }
    if (body && typeof body === "object" && "error" in body) {
        const e = body.error;
        if (typeof e === "string")
            return e;
    }
    return null;
}
export async function callLogin(input) {
    return (await serverFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
    }, false));
}
export async function callSignup(input) {
    return (await serverFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(input),
    }, false));
}
export async function callFetchLicense() {
    return (await serverFetch("/api/license", { method: "GET" }));
}
export async function callRegisterInstall(input) {
    return (await serverFetch("/api/installs/register", {
        method: "POST",
        body: JSON.stringify(input),
    }));
}
export async function callListInstalls() {
    return (await serverFetch("/api/installs", { method: "GET" }));
}
export async function callUnregisterInstall(id) {
    await serverFetch(`/api/installs/${encodeURIComponent(id)}`, { method: "DELETE" });
}
/**
 * Report usage to the server (budget dashboard). Best-effort: callers race
 * this against a short timeout and swallow errors — a usage report must
 * never delay or fail the tool's own work.
 */
export async function callReportUsage(input) {
    return serverFetch("/api/usage/report", {
        method: "POST",
        body: JSON.stringify(input),
    });
}
export async function callMe() {
    return (await serverFetch("/api/me", { method: "GET" }));
}
//# sourceMappingURL=license.js.map