import { describe, it, expect, vi } from "vitest";
import { engageBrake, DEFAULT_POLICY } from "../src/brake.js";

describe("engageBrake", () => {
  it("stops everything and reports the measured time", async () => {
    const result = await engageBrake({
      reason: "test",
      stopAll: async () => ({ agents: 3, plans: 2 }),
    });
    expect(result.engaged).toBe(true);
    expect(result.stopped).toEqual({ agents: 3, plans: 2 });
    expect(result.withinSla).toBe(true);
    expect(typeof result.elapsedMs).toBe("number");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBe("test");
    expect(result.sla).toBe(1000);
  });

  it("uses the default 1000ms SLA when no policy is given", async () => {
    const result = await engageBrake({
      reason: "default",
      stopAll: async () => ({ agents: 0, plans: 0 }),
    });
    expect(result.sla).toBe(1000);
    expect(result.withinSla).toBe(true);
  });

  it("reports an SLA miss instead of hiding it", async () => {
    const result = await engageBrake({
      reason: "slow",
      policy: { ...DEFAULT_POLICY, brakeSlaMs: 5 },
      stopAll: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { agents: 1, plans: 1 };
      },
    });
    // A brake that quietly ran slow is worse than no brake.
    expect(result.engaged).toBe(true);
    expect(result.withinSla).toBe(false);
    expect(result.elapsedMs).toBeGreaterThan(5);
  });

  it("reports a failed brake as not engaged rather than swallowing the error", async () => {
    const result = await engageBrake({
      reason: "broken",
      stopAll: async () => {
        throw new Error("store unreachable");
      },
    });
    expect(result.engaged).toBe(false);
    expect(result.error).toBe("store unreachable");
    expect(result.withinSla).toBe(false);
  });

  it("measures elapsed time as a real number, not a promise", async () => {
    const result = await engageBrake({
      reason: "timing",
      stopAll: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return { agents: 1, plans: 0 };
      },
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(15);
    expect(result.elapsedMs).toBeLessThan(200);
  });

  it("respects a custom SLA", async () => {
    const result = await engageBrake({
      reason: "custom",
      policy: { ...DEFAULT_POLICY, brakeSlaMs: 50 },
      stopAll: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { agents: 1, plans: 0 };
      },
    });
    expect(result.sla).toBe(50);
    expect(result.withinSla).toBe(true);
  });

  it("never throws — even when stopAll throws", async () => {
    const fn = vi.fn();
    const result = await engageBrake({
      reason: "throw",
      onError: fn as never, // unused in pure module
      stopAll: async () => {
        throw new Error("boom");
      },
    }).catch(() => null);
    expect(result).not.toBeNull();
    expect((result as { engaged: boolean }).engaged).toBe(false);
  });
});
