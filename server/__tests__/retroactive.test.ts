/**
 * Retroactive analysis — the report a prospect runs on their OWN past data
 * before they are a customer. The standard is higher than for any other
 * report in the product: this is the first thing a skeptical buyer sees, and
 * if it overclaims what a plain export can actually show, it fails the
 * product's own honesty rule on the very first interaction.
 */

import { describe, expect, it } from "vitest";
import { analyzeRetroactive, type HistoricalCall } from "../analytics/retroactive.js";

const call = (over: Partial<HistoricalCall> = {}): HistoricalCall => ({
  at: Date.now(),
  ...over,
});

describe("retroactive loop detection", () => {
  it("flags three or more identical consecutive prompts", () => {
    const calls = [
      call({ promptPreview: "summarize ticket #4471", costCents: 10 }),
      call({ promptPreview: "summarize ticket #4471", costCents: 10 }),
      call({ promptPreview: "summarize ticket #4471", costCents: 10 }),
    ];
    const r = analyzeRetroactive(calls);
    expect(r.loops).toHaveLength(1);
    expect(r.loops[0].count).toBe(3);
    expect(r.loopCostCents).toBe(30);
  });

  it("does not flag two repeats — that is a legitimate retry, not a runaway loop", () => {
    const calls = [
      call({ promptPreview: "x", costCents: 5 }),
      call({ promptPreview: "x", costCents: 5 }),
    ];
    expect(analyzeRetroactive(calls).loops).toHaveLength(0);
  });

  it("does not flag different prompts, however similar the topic", () => {
    const calls = [
      call({ promptPreview: "summarize ticket #1" }),
      call({ promptPreview: "summarize ticket #2" }),
      call({ promptPreview: "summarize ticket #3" }),
    ];
    expect(analyzeRetroactive(calls).loops).toHaveLength(0);
  });

  it("finds multiple separate loops in one export", () => {
    const calls = [
      call({ promptPreview: "a", costCents: 1 }),
      call({ promptPreview: "a", costCents: 1 }),
      call({ promptPreview: "a", costCents: 1 }),
      call({ promptPreview: "b" }),
      call({ promptPreview: "c", costCents: 2 }),
      call({ promptPreview: "c", costCents: 2 }),
      call({ promptPreview: "c", costCents: 2 }),
      call({ promptPreview: "c", costCents: 2 }),
    ];
    const r = analyzeRetroactive(calls);
    expect(r.loops).toHaveLength(2);
    expect(r.loops[1].count).toBe(4);
  });
});

describe("cost honesty", () => {
  it("shows a total only when every row has a cost", () => {
    const complete = [call({ costCents: 10 }), call({ costCents: 20 })];
    expect(analyzeRetroactive(complete).totalCostCents).toBe(30);
  });

  it("refuses to show a partial total dressed up as a real one", () => {
    const partial = [call({ costCents: 10 }), call({})];
    const r = analyzeRetroactive(partial);
    expect(r.totalCostCents).toBeNull();
    expect(r.limitations.some((l) => l.includes("no cost figure"))).toBe(true);
  });
});

describe("commitment candidates are never claimed as confirmed", () => {
  it("flags a figure in a response as a candidate, not a finding", () => {
    const calls = [call({ responsePreview: "Sure, we can do $149/month for you." })];
    const r = analyzeRetroactive(calls);
    expect(r.commitmentCandidates).toHaveLength(1);
    expect(r.commitmentCandidates[0].matched).toContain("$149");
  });

  it("flags guarantee language even with no figure", () => {
    const calls = [call({ responsePreview: "We guarantee this will work for your case." })];
    expect(analyzeRetroactive(calls).commitmentCandidates).toHaveLength(1);
  });

  it("does not flag ordinary text", () => {
    const calls = [call({ responsePreview: "Here is a summary of the ticket." })];
    expect(analyzeRetroactive(calls).commitmentCandidates).toHaveLength(0);
  });

  it("always states that candidates are unconfirmed — the limitation is not conditional", () => {
    const calls = [call({ responsePreview: "no figures here" })];
    const r = analyzeRetroactive(calls);
    expect(r.limitations.some((l) => l.toLowerCase().includes("not"))).toBe(true);
  });
});

describe("edge cases", () => {
  it("handles an export with no prompt text at all", () => {
    const calls = [call({ costCents: 5 }), call({ costCents: 5 })];
    const r = analyzeRetroactive(calls);
    expect(r.loops).toHaveLength(0);
    expect(r.limitations.some((l) => l.includes("No prompt text"))).toBe(true);
  });

  it("does not throw on an empty array's narrative", () => {
    expect(() => analyzeRetroactive([])).not.toThrow();
    expect(analyzeRetroactive([]).narrative).toContain("No calls");
  });
});
