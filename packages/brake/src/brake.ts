/**
 * The emergency brake.
 *
 * Stop everything, now. The SLA is measured, not asserted. A brake that
 * quietly took 3 seconds while the UI said "1000ms SLA" is worse than no
 * brake, because the operator would have acted differently had they known.
 *
 * Pure module. No I/O, no global state, no opinion about storage. The caller
 * provides a `stopAll` callback that knows how to actually stop things in
 * their environment (kill PIDs, call a webhook, run a rollback script, hit
 * the cloud API, halt a tmux session — whatever fits).
 */

export interface EscalationPolicy {
  /** Brake must engage within this. Measured and reported even when missed. */
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
  /** True if `stopAll` returned without throwing. A thrown brake is not engaged. */
  engaged: boolean;
  /** Measured, so the SLA is a fact rather than a claim. */
  elapsedMs: number;
  /** True if `elapsedMs <= policy.brakeSlaMs`. Reported even when false. */
  withinSla: boolean;
  stopped: BrakeStopped;
  reason: string;
  timestamp: number;
  sla: number;
  /** Present when `engaged` is false — the error string from the failed stopAll. */
  error?: string;
}

export interface BrakeOptions {
  reason: string;
  policy?: EscalationPolicy;
  /** Injected so this module has no opinion about storage or transport. */
  stopAll: () => Promise<BrakeStopped>;
}

export async function engageBrake(opts: BrakeOptions): Promise<BrakeResult> {
  const policy = opts.policy ?? DEFAULT_POLICY;
  const started = Date.now();
  const sla = policy.brakeSlaMs;

  let stopped: BrakeStopped = { agents: 0, plans: 0 };
  try {
    stopped = await opts.stopAll();
  } catch (err) {
    // A brake that throws is a brake that did not engage. Report it as such
    // rather than letting the exception look like success upstream.
    const elapsedMs = Date.now() - started;
    return {
      engaged: false,
      elapsedMs,
      withinSla: false,
      stopped,
      reason: opts.reason,
      timestamp: started,
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
    sla,
  };
}
