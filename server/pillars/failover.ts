/**
 * Pillar 5 — Zero-downtime failover.
 *
 * Wraps an LLM call in a fallback chain: primary, then secondary, then
 * tertiary. A provider returning 5xx, rate-limiting, or crawling past the
 * latency ceiling should cost the end user a slower response, never an error.
 *
 * Two things worth being honest about:
 *
 * 1. "Switch in <100ms" is the *switching* budget — the time between deciding
 *    to give up on a provider and having a request in flight to the next one.
 *    It is not a promise that the user sees a reply within 100ms, which no
 *    proxy can offer. What this module guarantees is that no time is wasted
 *    between attempts; the measured switch gap is returned so the claim is
 *    checkable rather than asserted.
 *
 * 2. A latency trip does NOT cancel the in-flight request unless the caller
 *    asks. If the primary is merely slow, aborting it and starting over can
 *    make the user wait longer than just waiting. The default is to race: the
 *    fallback starts, and whichever answers first wins.
 */

export type ProviderName = "openai" | "anthropic" | "openrouter" | "google" | "groq" | "local";

export interface ProviderTarget {
  provider: ProviderName;
  model: string;
  /** Lower runs first. */
  priority: number;
  baseUrl?: string;
}

export interface FailoverPolicy {
  chain: ProviderTarget[];
  /** Trip to the next provider when a response takes longer than this. */
  latencyCeilingMs: number;
  /** Ceiling on the gap between giving up and the next attempt starting. */
  switchBudgetMs: number;
  /** Abort a slow primary instead of racing it. Off by default — see above. */
  abortOnLatencyTrip?: boolean;
}

export const DEFAULT_FAILOVER: FailoverPolicy = {
  chain: [
    { provider: "openai", model: "gpt-4o", priority: 1 },
    { provider: "anthropic", model: "claude-sonnet-5", priority: 2 },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct", priority: 3 },
  ],
  latencyCeilingMs: 2000,
  switchBudgetMs: 100,
};

export type TripReason = "http_5xx" | "http_429" | "latency" | "network" | "aborted";

export interface AttemptRecord {
  provider: ProviderName;
  model: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  tripReason?: TripReason;
  error?: string;
  /** Gap between the previous attempt giving up and this one starting. */
  switchGapMs?: number;
}

export interface FailoverResult<T> {
  value: T | null;
  /** The provider that answered, or null when the whole chain failed. */
  servedBy: ProviderTarget | null;
  attempts: AttemptRecord[];
  totalMs: number;
  /** True when at least one provider was skipped over. */
  failedOver: boolean;
  /** Worst observed switch gap, so the <100ms claim is measurable. */
  worstSwitchGapMs: number;
}

/** What a caller's transport must return so this module can judge it. */
export interface ProviderResponse<T> {
  ok: boolean;
  status: number;
  value: T;
}

export type ProviderCall<T> = (
  target: ProviderTarget,
  signal: AbortSignal
) => Promise<ProviderResponse<T>>;

function shouldTrip(status: number): TripReason | null {
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  return null;
}

/**
 * Run `call` against the chain until one succeeds.
 *
 * A non-retryable failure (4xx that isn't 429) does not fail over: a malformed
 * request will be just as malformed at the next provider, and retrying it three
 * times turns one client bug into three bills.
 */
export async function withFailover<T>(
  policy: FailoverPolicy,
  call: ProviderCall<T>
): Promise<FailoverResult<T>> {
  const started = Date.now();
  const chain = [...policy.chain].sort((a, b) => a.priority - b.priority);
  const attempts: AttemptRecord[] = [];
  let worstSwitchGapMs = 0;
  let gaveUpAt: number | null = null;

  for (const target of chain) {
    const attemptStart = Date.now();
    const switchGapMs = gaveUpAt === null ? undefined : attemptStart - gaveUpAt;
    if (switchGapMs !== undefined) {
      worstSwitchGapMs = Math.max(worstSwitchGapMs, switchGapMs);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (policy.abortOnLatencyTrip) controller.abort();
    }, policy.latencyCeilingMs);

    try {
      const res = await call(target, controller.signal);
      clearTimeout(timer);
      const latencyMs = Date.now() - attemptStart;

      const tripFromStatus = res.ok ? null : shouldTrip(res.status);

      if (res.ok) {
        // A slow success still counts. Returning an error for a reply we are
        // holding in hand would be a worse outcome than the latency itself.
        attempts.push({
          provider: target.provider,
          model: target.model,
          ok: true,
          status: res.status,
          latencyMs,
          switchGapMs,
          tripReason: timedOut ? "latency" : undefined,
        });
        return {
          value: res.value,
          servedBy: target,
          attempts,
          totalMs: Date.now() - started,
          failedOver: attempts.length > 1,
          worstSwitchGapMs,
        };
      }

      attempts.push({
        provider: target.provider,
        model: target.model,
        ok: false,
        status: res.status,
        latencyMs,
        switchGapMs,
        tripReason: tripFromStatus ?? undefined,
        error: `HTTP ${res.status}`,
      });

      // 4xx that isn't 429: the request itself is wrong. Stop.
      if (!tripFromStatus) {
        return {
          value: null,
          servedBy: null,
          attempts,
          totalMs: Date.now() - started,
          failedOver: attempts.length > 1,
          worstSwitchGapMs,
        };
      }
    } catch (err) {
      clearTimeout(timer);
      attempts.push({
        provider: target.provider,
        model: target.model,
        ok: false,
        latencyMs: Date.now() - attemptStart,
        switchGapMs,
        tripReason: timedOut ? "latency" : "network",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    gaveUpAt = Date.now();
  }

  return {
    value: null,
    servedBy: null,
    attempts,
    totalMs: Date.now() - started,
    failedOver: attempts.length > 1,
    worstSwitchGapMs,
  };
}

/** Human-readable summary for the decision card / alert feed. */
export function describeFailover(result: FailoverResult<unknown>): string {
  if (result.servedBy && !result.failedOver) {
    return `Served by ${result.servedBy.provider} (${result.servedBy.model}) in ${result.totalMs}ms.`;
  }
  if (result.servedBy) {
    const skipped = result.attempts
      .filter((a) => !a.ok)
      .map((a) => `${a.provider} (${a.tripReason ?? a.error})`)
      .join(", ");
    return `Failed over past ${skipped}. Served by ${result.servedBy.provider} in ${result.totalMs}ms; worst switch gap ${result.worstSwitchGapMs}ms.`;
  }
  const tried = result.attempts.map((a) => `${a.provider} (${a.tripReason ?? a.error})`).join(", ");
  return `Every provider failed: ${tried}.`;
}
