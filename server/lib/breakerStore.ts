/**
 * Counter store for the deterministic circuit breaker.
 *
 * Deliberately a narrow interface: the breaker only ever needs to increment a
 * counter, read it, and push/read a sliding window of timestamps. That keeps
 * the hot path free of anything that could add latency or fail in interesting
 * ways, and it means the Redis implementation is a drop-in later without
 * touching breaker logic.
 *
 * Default is in-process memory, which is what makes the <100ms SLA in
 * DIRECTIVE 2 actually achievable — every check below is sub-millisecond with
 * no network hop. The trade-off is stated plainly:
 *
 *   Memory store limits are PER INSTANCE. On a single long-lived Node process
 *   (Render/Railway/Fly) that is a true global limit. On Vercel serverless,
 *   where each invocation may be a fresh isolate, a client could exceed a hard
 *   budget by up to (number of concurrent isolates) × limit. If the proxy runs
 *   serverless, use a shared store (Redis) — see RedisBreakerStore notes.
 */

export interface BreakerStore {
  /** Add `by` to a counter, returning the new total. Creates it if absent. */
  incr(key: string, by: number, ttlMs: number): Promise<number>;
  /** Read a counter (0 if absent/expired). */
  get(key: string): Promise<number>;
  /**
   * Record an event at `at` in a sliding window and return how many events
   * remain inside `windowMs`. Used for velocity + loop detection.
   */
  pushWindow(key: string, at: number, windowMs: number): Promise<number>;
  /** Count events in a window without adding one. */
  countWindow(key: string, now: number, windowMs: number): Promise<number>;
  /** Clear everything under a session (used when a human resets a breach). */
  resetSession(sessionId: string): Promise<void>;
}

interface Counter {
  value: number;
  expiresAt: number;
}

export class MemoryBreakerStore implements BreakerStore {
  private counters = new Map<string, Counter>();
  private windows = new Map<string, number[]>();
  private lastSweep = 0;

  /** Drop expired entries occasionally so a long-lived process can't leak. */
  private sweep(now: number) {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [k, c] of Array.from(this.counters.entries())) {
      if (c.expiresAt <= now) this.counters.delete(k);
    }
    for (const [k, times] of Array.from(this.windows.entries())) {
      // A window key with nothing in the last hour is dead weight.
      if (times.length === 0 || now - times[times.length - 1] > 3_600_000) {
        this.windows.delete(k);
      }
    }
  }

  async incr(key: string, by: number, ttlMs: number): Promise<number> {
    const now = Date.now();
    this.sweep(now);
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      this.counters.set(key, { value: by, expiresAt: now + ttlMs });
      return by;
    }
    existing.value += by;
    return existing.value;
  }

  async get(key: string): Promise<number> {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) return 0;
    return existing.value;
  }

  async pushWindow(key: string, at: number, windowMs: number): Promise<number> {
    this.sweep(at);
    const times = this.windows.get(key) ?? [];
    times.push(at);
    // Trim from the front — the array is append-ordered so a single scan works.
    const cutoff = at - windowMs;
    let i = 0;
    while (i < times.length && times[i] < cutoff) i++;
    const trimmed = i > 0 ? times.slice(i) : times;
    this.windows.set(key, trimmed);
    return trimmed.length;
  }

  async countWindow(key: string, now: number, windowMs: number): Promise<number> {
    const times = this.windows.get(key);
    if (!times) return 0;
    const cutoff = now - windowMs;
    let count = 0;
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] < cutoff) break;
      count++;
    }
    return count;
  }

  async resetSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}:`;
    for (const k of Array.from(this.counters.keys())) {
      if (k.startsWith(prefix)) this.counters.delete(k);
    }
    for (const k of Array.from(this.windows.keys())) {
      if (k.startsWith(prefix)) this.windows.delete(k);
    }
  }
}

/**
 * To move to Redis, implement this same interface with:
 *   incr        → INCRBY + PEXPIRE (in a MULTI so the TTL can't be lost)
 *   get         → GET
 *   pushWindow  → ZADD + ZREMRANGEBYSCORE + ZCARD (MULTI)
 *   countWindow → ZCOUNT
 *   resetSession→ SCAN + UNLINK on the `<sessionId>:*` prefix
 * and pass it to createCircuitBreaker({ store }). Nothing else changes.
 *
 * Budget note: a Redis round trip is typically 1–5ms in-region, which still
 * fits the <100ms SLA, but it introduces a dependency that can fail. Decide
 * fail-open vs fail-closed explicitly (see `onStoreError` in circuitBreaker).
 */

/** The default process-wide store. */
export const memoryStore = new MemoryBreakerStore();
