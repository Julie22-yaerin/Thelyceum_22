/**
 * Throughput regression test — see brake's copy of this file for the full
 * rationale. Floor set below the measured ~494k calls/sec so this fails on a
 * real regression, not CI noise.
 */

import { describe, expect, it } from "vitest";
import { challenge } from "../src/challenge.js";

const CORPUS = [
  "Research shows this migration is totally safe, no downside at all.",
  "We should switch to the new stack.",
  "The only option is to rewrite everything from scratch.",
  "In my experience this always works fine.",
  "If we allow this exception, everyone will want one.",
  "Assuming the API stays stable, this should be fine.",
  "This is definitely the right call, no doubt about it.",
  "The tests pass, so the refactor is done.",
  "Critics say this is risky, but they just don't understand the architecture.",
  "We measured a 12% latency improvement after the change, with a rollback plan if p99 regresses.",
];

describe("challenge throughput", () => {
  it("stays well above the floor an agent harness needs", () => {
    for (let i = 0; i < 10_000; i++) challenge(CORPUS[i % CORPUS.length]);

    const N = 100_000;
    const start = process.hrtime.bigint();
    for (let i = 0; i < N; i++) challenge(CORPUS[i % CORPUS.length]);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    const callsPerSec = N / (elapsedMs / 1000);
    expect(callsPerSec).toBeGreaterThan(100_000);
  });

  it("does not degrade badly on a long adversarial-looking input", () => {
    const long = ("Research shows " + "this is definitely true, ".repeat(30)).repeat(50);
    const start = process.hrtime.bigint();
    challenge(long);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(50);
  });
});
