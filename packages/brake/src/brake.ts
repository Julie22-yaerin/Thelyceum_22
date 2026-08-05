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

export const DEFAULT_POLICY: EscalationPolicy = {
  brakeSlaMs: 1000,
};

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

export async function engageBrake(opts: BrakeOptions): Promise<BrakeResult> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const started = Date.now();
  const timestampIso = new Date(started).toISOString();
  const sla = policy.brakeSlaMs;
  const environment = opts.environment ?? (process.env.BRAKE_ENVIRONMENT === "cloud" ? "cloud" : "local");
  const cloudRegion = opts.cloudRegion ?? process.env.BRAKE_CLOUD_REGION ?? (environment === "cloud" ? "us-east-1" : undefined);
  const tokensSaved = opts.tokensSaved ?? 0;
  const dollarsSaved = opts.dollarsSaved ?? parseFloat((tokensSaved * 0.000015).toFixed(4));

  let stopped: BrakeStopped = { agents: 0, plans: 0 };
  try {
    stopped = await opts.stopAll();
  } catch (err) {
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
