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
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { BRAKE_HOME } from "./config.js";

const LICENSE_PATH = join(BRAKE_HOME, "license.json");
const SESSION_PATH = join(BRAKE_HOME, "session.json");

const DEFAULT_SERVER_URL = process.env.BRAKE_SERVER_URL ?? "https://brake.example";

export interface StoredLicense {
  token: string;
  plan: string;
  billing: string;
  expiresAt: number;
  autoRenew: boolean;
  fetchedAt: number;
}

export interface StoredSession {
  token: string;
  email: string;
  fetchedAt: number;
}

export function licensePath(): string { return LICENSE_PATH; }
export function sessionPath(): string { return SESSION_PATH; }

export function getServerUrl(): string {
  // loadConfig is async; for a simple getter we use the env override if
  // present, otherwise fall back to the default. The actual config-file
  // value is read in async serverFetch when needed.
  return process.env.BRAKE_SERVER_URL ?? DEFAULT_SERVER_URL;
}

export async function loadLicense(): Promise<StoredLicense | null> {
  if (!existsSync(LICENSE_PATH)) return null;
  try {
    const raw = await fs.readFile(LICENSE_PATH, "utf-8");
    return JSON.parse(raw) as StoredLicense;
  } catch {
    return null;
  }
}

export async function saveLicense(lic: StoredLicense): Promise<void> {
  await fs.mkdir(dirname(LICENSE_PATH), { recursive: true });
  await fs.writeFile(LICENSE_PATH, JSON.stringify(lic, null, 2) + "\n", "utf-8");
}

export async function clearLicense(): Promise<void> {
  await fs.unlink(LICENSE_PATH).catch(() => {});
  await fs.unlink(SESSION_PATH).catch(() => {});
}

export async function loadSession(): Promise<StoredSession | null> {
  if (!existsSync(SESSION_PATH)) return null;
  try {
    const raw = await fs.readFile(SESSION_PATH, "utf-8");
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function saveSession(s: StoredSession): Promise<void> {
  await fs.mkdir(dirname(SESSION_PATH), { recursive: true });
  await fs.writeFile(SESSION_PATH, JSON.stringify(s, null, 2) + "\n", "utf-8");
}

export interface ServerError extends Error {
  status?: number;
  body?: unknown;
}

async function serverFetch(path: string, init: RequestInit = {}, requireAuth = true): Promise<unknown> {
  const url = new URL(path, getServerUrl()).toString();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) };
  if (requireAuth) {
    const session = await loadSession();
    if (!session) {
      const e = new Error("not logged in — run `brake login` first") as ServerError;
      e.status = 401;
      throw e;
    }
    headers["Authorization"] = `Bearer ${session.token}`;
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const e = new Error(extractErrorMessage(json) ?? `server returned ${res.status}`) as ServerError;
    e.status = res.status;
    e.body = json;
    throw e;
  }
  return json;
}

function extractErrorMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === "string") return e;
  }
  return null;
}

export interface LoginInput { email: string; password: string; }
export interface LoginResult { sessionToken: string; user: { id: string; email: string }; }

export async function callLogin(input: LoginInput): Promise<LoginResult> {
  return (await serverFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  }, false)) as LoginResult;
}

export async function callSignup(input: LoginInput): Promise<LoginResult> {
  return (await serverFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(input),
  }, false)) as LoginResult;
}

export interface LicenseResponse { token: string; plan: string; billing: string; expiresAt: number; autoRenew: boolean; }

export async function callFetchLicense(): Promise<LicenseResponse> {
  return (await serverFetch("/api/license", { method: "GET" })) as LicenseResponse;
}

export interface RegisterInstallInput {
  hostType: "claude-desktop" | "claude-code" | "chatgpt";
  deviceId: string;
  hostMeta?: Record<string, unknown>;
}

export interface RegisterInstallResult {
  install: { id: string; host_type: string; device_id: string; installed_at: number; last_seen_at: number };
  total: number;
  limit: number;
}

export async function callRegisterInstall(input: RegisterInstallInput): Promise<RegisterInstallResult> {
  return (await serverFetch("/api/installs/register", {
    method: "POST",
    body: JSON.stringify(input),
  })) as RegisterInstallResult;
}

export async function callListInstalls(): Promise<{ installs: { id: string; host_type: string; device_id: string; last_seen_at: number }[]; total: number; limit: number }> {
  return (await serverFetch("/api/installs", { method: "GET" })) as { installs: { id: string; host_type: string; device_id: string; last_seen_at: number }[]; total: number; limit: number };
}

export async function callUnregisterInstall(id: string): Promise<void> {
  await serverFetch(`/api/installs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface UsageReportInput {
  tool: "brake" | "redteam" | "thrift";
  kind: string;
  tokens?: number;
  calls?: number;
}

/**
 * Report usage to the server (budget dashboard). Best-effort: callers race
 * this against a short timeout and swallow errors — a usage report must
 * never delay or fail the tool's own work.
 */
export async function callReportUsage(input: UsageReportInput): Promise<unknown> {
  return serverFetch("/api/usage/report", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface MeResponse {
  user: { id: string; email: string; createdAt: number };
  subscription: null | { id: string; plan: string; billing: string; status: string; expires_at: number; auto_renew: number };
  installs: { id: string; host_type: string; device_id: string; last_seen_at: number }[];
  connectionCount: number;
  connectionLimit: number;
}

export async function callMe(): Promise<MeResponse> {
  return (await serverFetch("/api/me", { method: "GET" })) as MeResponse;
}
