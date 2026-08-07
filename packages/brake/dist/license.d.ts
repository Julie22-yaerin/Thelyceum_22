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
export declare function licensePath(): string;
export declare function sessionPath(): string;
export declare function getServerUrl(): string;
export declare function loadLicense(): Promise<StoredLicense | null>;
export declare function saveLicense(lic: StoredLicense): Promise<void>;
export declare function clearLicense(): Promise<void>;
export declare function loadSession(): Promise<StoredSession | null>;
export declare function saveSession(s: StoredSession): Promise<void>;
export interface ServerError extends Error {
    status?: number;
    body?: unknown;
}
export interface LoginInput {
    email: string;
    password: string;
}
export interface LoginResult {
    sessionToken: string;
    user: {
        id: string;
        email: string;
    };
}
export declare function callLogin(input: LoginInput): Promise<LoginResult>;
export declare function callSignup(input: LoginInput): Promise<LoginResult>;
export interface LicenseResponse {
    token: string;
    plan: string;
    billing: string;
    expiresAt: number;
    autoRenew: boolean;
}
export declare function callFetchLicense(): Promise<LicenseResponse>;
export interface RegisterInstallInput {
    hostType: "claude-desktop" | "claude-code" | "chatgpt";
    deviceId: string;
    hostMeta?: Record<string, unknown>;
}
export interface RegisterInstallResult {
    install: {
        id: string;
        host_type: string;
        device_id: string;
        installed_at: number;
        last_seen_at: number;
    };
    total: number;
    limit: number;
}
export declare function callRegisterInstall(input: RegisterInstallInput): Promise<RegisterInstallResult>;
export declare function callListInstalls(): Promise<{
    installs: {
        id: string;
        host_type: string;
        device_id: string;
        last_seen_at: number;
    }[];
    total: number;
    limit: number;
}>;
export declare function callUnregisterInstall(id: string): Promise<void>;
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
export declare function callReportUsage(input: UsageReportInput): Promise<unknown>;
export interface MeResponse {
    user: {
        id: string;
        email: string;
        createdAt: number;
    };
    subscription: null | {
        id: string;
        plan: string;
        billing: string;
        status: string;
        expires_at: number;
        auto_renew: number;
    };
    installs: {
        id: string;
        host_type: string;
        device_id: string;
        last_seen_at: number;
    }[];
    connectionCount: number;
    connectionLimit: number;
}
export declare function callMe(): Promise<MeResponse>;
//# sourceMappingURL=license.d.ts.map