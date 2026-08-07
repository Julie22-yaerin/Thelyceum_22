/**
 * The default `stopAll` implementation.
 *
 * Pulling the brake in a standalone deployment has to do something even when
 * the user has not configured anything. This file is what gets called.
 *
 * Order of operations (each step is best-effort; failures are swallowed so a
 * misconfigured webhook does not prevent the PIDs from getting killed):
 *   1. Kill every PID listed in $BRAKE_PID_DIR (default ~/.brake/pids/*.pid).
 *   2. Run $BRAKE_STOP_SCRIPT if it exists and is executable.
 *   3. POST the brake event to $BRAKE_WEBHOOK_URL if set.
 *   4. Append an audit line to $BRAKE_AUDIT_PATH.
 *
 * The user can override any of these with environment variables, and they
 * can pass their own `stopAll` to `engageBrake` for full control.
 */
import type { BrakeStopped } from "./brake.js";
export declare const DEFAULT_PID_DIR: string;
export declare const DEFAULT_AUDIT_PATH: string;
export interface StopAllConfig {
    pidDir?: string;
    auditPath?: string;
    webhookUrl?: string;
    stopScript?: string;
}
export declare function makeStopAll(config?: StopAllConfig): () => Promise<BrakeStopped>;
/**
 * Register a PID as something the brake should kill.
 * Writes a .pid file the next engageBrake call will read and SIGTERM.
 */
export declare function trackPid(pid: number, label: string, pidDir?: string): Promise<void>;
export declare function untrackPid(label: string, pidDir?: string): Promise<void>;
//# sourceMappingURL=stop-all.d.ts.map