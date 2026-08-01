import { describe, it, expect } from "vitest";
import { challenge, rebut, listFlawRules, MAX_UNBLOCKED_FLAGS, FLAW_CLASSES } from "../src/challenge.js";

describe("challenge", () => {
  it("returns high confidence and no flags for empty text", () => {
    const result = challenge("");
    expect(result.flags).toEqual([]);
    expect(result.verdict.blocked).toBe(false);
    expect(result.verdict.confidence).toBe("high");
  });

  it("returns high confidence for balanced, ordinary text", () => {
    const safe = [
      "Let's weigh the options. The rewrite is faster but costs more to maintain.",
      "I recommend Postgres for this workload; the migration risk is downtime and we have a rollback plan.",
      "The trade-off is between speed and safety, and we should decide based on the failure budget.",
    ];
    for (const text of safe) {
      const result = challenge(text);
      expect(result.flags, `expected no flags for: ${text}`).toEqual([]);
      expect(result.verdict.blocked).toBe(false);
      expect(result.verdict.confidence).toBe("high");
    }
  });

  it("catches overconfidence", () => {
    const result = challenge("This approach obviously works, no doubt.");
    expect(result.flags.some((f) => f.flaw === "overconfidence")).toBe(true);
    expect(result.flags[0].evidence.length).toBeLessThanOrEqual(200);
  });

  it("catches unsupported claims (blocking)", () => {
    const result = challenge("Research shows this migration is totally safe.");
    expect(result.flags.some((f) => f.flaw === "unsupported_claim")).toBe(true);
    expect(result.verdict.blocked).toBe(true);
    expect(result.verdict.confidence).toBe("low");
  });

  it("catches confirmation bias (blocking)", () => {
    const result = challenge("There's no downside and no risks — it's the perfect solution.");
    expect(result.flags.some((f) => f.flaw === "confirmation_bias")).toBe(true);
    expect(result.verdict.blocked).toBe(true);
  });

  it("catches false dichotomies", () => {
    const result = challenge("The only option is to rewrite everything.");
    expect(result.flags.some((f) => f.flaw === "false_dichotomy")).toBe(true);
  });

  it("catches missing trade-offs when a decision has no downside priced", () => {
    const result = challenge("We should migrate to Postgres. I recommend it.");
    expect(result.flags.some((f) => f.flaw === "missing_tradeoff")).toBe(true);
  });

  it("does NOT flag a decision that prices its downside", () => {
    const result = challenge("We should migrate to Postgres; the main risk is downtime during the cutover.");
    expect(result.flags.some((f) => f.flaw === "missing_tradeoff")).toBe(false);
  });

  it("catches straw men", () => {
    const result = challenge("Critics claim the old system is slow, but they just don't understand it.");
    expect(result.flags.some((f) => f.flaw === "strawman")).toBe(true);
  });

  it("catches anecdote-as-evidence", () => {
    const result = challenge("In my experience, this library never fails.");
    expect(result.flags.some((f) => f.flaw === "anecdote_as_evidence")).toBe(true);
  });

  it("catches slippery slopes", () => {
    const result = challenge("If we allow one exception, then everyone will ask for more and the policy collapses.");
    expect(result.flags.some((f) => f.flaw === "slippery_slope")).toBe(true);
  });

  it("catches unchecked assumptions", () => {
    const result = challenge("Assuming the API stays stable, we can ship the client.");
    expect(result.flags.some((f) => f.flaw === "unchecked_assumption")).toBe(true);
  });

  it("understands Vietnamese reasoning", () => {
    const result = challenge("Phương án này rõ ràng là tốt nhất, không có rủi ro nào.");
    expect(result.flags.some((f) => f.flaw === "overconfidence")).toBe(true);
    expect(result.flags.some((f) => f.flaw === "confirmation_bias")).toBe(true);
    expect(result.verdict.blocked).toBe(true);
  });

  it("blocks on volume when many non-blocking flags accumulate", () => {
    const text = "Obviously the only option is this approach. In my experience it always works. Research shows it's best.";
    const result = challenge(text);
    expect(result.flags.length).toBeGreaterThanOrEqual(MAX_UNBLOCKED_FLAGS);
    expect(result.verdict.blocked).toBe(true);
  });

  it("respects a custom blockOn set", () => {
    const blockOn = new Set(["overconfidence"] as const);
    const result = challenge("This obviously works.", { blockOn });
    expect(result.verdict.blocked).toBe(true);
    const defaultResult = challenge("This obviously works.");
    expect(defaultResult.verdict.blocked).toBe(false);
  });

  it("always returns generic steelman counters", () => {
    const result = challenge("");
    expect(result.counter.length).toBeGreaterThanOrEqual(4);
    expect(result.counter[0]).toMatch(/opposing position/i);
  });

  it("appends flaw-specific counters for flagged flaws", () => {
    const result = challenge("Research shows this migration is totally safe.");
    expect(result.counter.some((c) => /source/i.test(c))).toBe(true);
  });

  it("rebut returns counters and verdict", () => {
    const result = rebut("We should switch to the new stack.");
    expect(result.verdict).toBeDefined();
    expect(result.counter.length).toBeGreaterThan(0);
    expect(result.flags).toBeDefined();
  });
});

describe("listFlawRules", () => {
  it("covers every flaw class", () => {
    const rules = listFlawRules();
    const classes = new Set(rules.map((r) => r.flaw));
    for (const c of FLAW_CLASSES) {
      expect(classes.has(c)).toBe(true);
    }
  });

  it("marks unsupported_claim and confirmation_bias as blocking", () => {
    const rules = listFlawRules();
    expect(rules.find((r) => r.flaw === "unsupported_claim")?.blocking).toBe(true);
    expect(rules.find((r) => r.flaw === "confirmation_bias")?.blocking).toBe(true);
  });
});
