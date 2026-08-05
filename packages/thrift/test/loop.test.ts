import { describe, it, expect, beforeEach } from "vitest";
import { globalLoopTracker, MAX_ALLOWED_REPETITIONS } from "../src/loop.js";

describe("Runaway Loop Interceptor (Thrift Saver)", () => {
  beforeEach(() => {
    globalLoopTracker.reset();
  });

  it("allows action on first call", () => {
    const res = globalLoopTracker.trackAndCheck("npm test");
    expect(res.tripped).toBe(false);
    expect(res.action).toBe("allow");
    expect(res.repetitionCount).toBe(1);
  });

  it("allows action on second call (up to max 2)", () => {
    globalLoopTracker.trackAndCheck("npm test");
    const res = globalLoopTracker.trackAndCheck("npm test");
    expect(res.tripped).toBe(false);
    expect(res.action).toBe("allow");
    expect(res.repetitionCount).toBe(2);
  });

  it("INTERCEPTS and TRIPS execution on 3rd call (> 2 repetitions)", () => {
    globalLoopTracker.trackAndCheck("npm test");
    globalLoopTracker.trackAndCheck("npm test");
    const res = globalLoopTracker.trackAndCheck("npm test");

    expect(res.tripped).toBe(true);
    expect(res.action).toBe("intercept_loop");
    expect(res.repetitionCount).toBe(3);
    expect(res.maxAllowed).toBe(MAX_ALLOWED_REPETITIONS);
    expect(res.tokensSaved).toBeGreaterThan(200000);
    expect(res.dollarsSaved).toBeGreaterThan(0);
    expect(res.reason).toMatch(/Runaway loop intercepted/i);
  });
});
