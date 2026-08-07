/**
 * The emergency brake engine (Local & Cloud).
 *
 * Stop everything, fast. Measured SLA (< 1000ms).
 * Logs blocked actions, timestamps, cloud environment context, and calculated token savings.
 */
export const DEFAULT_POLICY = {
    brakeSlaMs: 1000,
};
export async function engageBrake(opts) {
    const policy = opts.policy ?? DEFAULT_POLICY;
    const started = Date.now();
    const timestampIso = new Date(started).toISOString();
    const sla = policy.brakeSlaMs;
    const environment = opts.environment ?? (process.env.BRAKE_ENVIRONMENT === "cloud" ? "cloud" : "local");
    const cloudRegion = opts.cloudRegion ?? process.env.BRAKE_CLOUD_REGION ?? (environment === "cloud" ? "us-east-1" : undefined);
    const tokensSaved = opts.tokensSaved ?? 0;
    const dollarsSaved = opts.dollarsSaved ?? parseFloat((tokensSaved * 0.000015).toFixed(4));
    let stopped = { agents: 0, plans: 0 };
    try {
        stopped = await opts.stopAll();
    }
    catch (err) {
        const elapsedMs = Date.now() - started;
        return {
            engaged: false,
            elapsedMs,
            withinSla: false,
            stopped,
            reason: opts.reason,
            timestamp: started,
            timestampIso,
            environment,
            cloudRegion,
            tokensSaved,
            dollarsSaved,
            sla,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    const elapsedMs = Date.now() - started;
    return {
        engaged: true,
        elapsedMs,
        withinSla: elapsedMs <= sla,
        stopped,
        reason: opts.reason,
        timestamp: started,
        timestampIso,
        environment,
        cloudRegion,
        tokensSaved,
        dollarsSaved,
        sla,
    };
}
//# sourceMappingURL=brake.js.map