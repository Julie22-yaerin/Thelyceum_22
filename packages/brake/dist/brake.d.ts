/**
 * The emergency brake engine (Local & Cloud).
 *
 * Stop everything, fast. Measured SLA (< 1000ms).
 * Logs blocked actions, timestamps, cloud environment context, and calculated token savings.
 */
export interface EscalationPolicy {
    /** Brake must engage within this SLA (ms). Measured and reported. */
    brakeSlaMs: number;
}
export declare const DEFAULT_POLICY: EscalationPolicy;
export interface BrakeStopped {
    agents: number;
    plans: number;
}
export interface BrakeResult {
    /** True if `stopAll` returned without throwing. */
    engaged: boolean;
    /** Measured SLA elapsed time in ms. */
    elapsedMs: number;
    /** True if `elapsedMs <= policy.brakeSlaMs`. */
    withinSla: boolean;
    stopped: BrakeStopped;
    reason: string;
    timestamp: number;
    timestampIso: string;
    environment: "local" | "cloud";
    cloudRegion?: string;
    tokensSaved: number;
    dollarsSaved: number;
    sla: number;
    /** Present when `engaged` is false — error string from failed stopAll. */
    error?: string;
}
export interface BrakeOptions {
    reason: string;
    policy?: EscalationPolicy;
    tokensSaved?: number;
    dollarsSaved?: number;
    environment?: "local" | "cloud";
    cloudRegion?: string;
    /** Injected callback to stop agent processes / cloud tasks. */
    stopAll: () => Promise<BrakeStopped>;
}
export declare function engageBrake(opts: BrakeOptions): Promise<BrakeResult>;
//# sourceMappingURL=brake.d.ts.map