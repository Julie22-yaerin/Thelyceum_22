/**
 * Throughput regression test.
 *
 * The landing page claims a specific calls/sec figure for scanForDanger — the
 * function on the hot path of every single tool call an agent harness makes,
 * not just the rare moment the brake is actually pulled. A performance claim
 * that isn't re-checked by CI is a claim that quietly goes stale the first
 * time someone adds a regex to danger.ts without thinking about backtracking.
 *
 * The floor here is set well below the measured number (a laptop measured
 * ~1.37M calls/sec; the floor is 200k) so this fails on an actual regression,
 * not on CI machine noise.
 */

import { describe, expect, it } from "vitest";
import { scanForDanger } from "../src/danger.js";

const CORPUS = [
  "summarize this ticket for me",
  "export all customer records to s3",
  "draft an email to the customer about their invoice",
  "run nmap against the staging host",
  "read the API key from the env file",
  "delete the draft I saved earlier",
  "rm -rf /var/data",
  "check whether the API is responding",
  "transfer funds to the vendor account",
  "update the pricing page copy",
];

describe("scanForDanger throughput", () => {
  it("stays well above the floor an agent harness needs", () => {
    // Warm up so JIT compilation doesn't get counted as part of the measurement.
    for (let i = 0; i < 20_000; i++) scanForDanger(CORPUS[i % CORPUS.length]);

    const N = 200_000;
    const start = process.hrtime.bigint();
    for (let i = 0; i < N; i++) scanForDanger(CORPUS[i % CORPUS.length]);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    const callsPerSec = N / (elapsedMs / 1000);
    // A real agent harness making one tool call every ~100ms across a fleet
    // of a few hundred concurrent agents needs low thousands of scans/sec.
    // 200k/sec leaves three orders of magnitude of headroom on a single core.
    expect(callsPerSec).toBeGreaterThan(200_000);
  });

  it("does not degrade badly on a long adversarial-looking input", () => {
    // A pathological regex can go quadratic on a crafted string. This is not
    // exhaustive ReDoS coverage — it is a tripwire: if someone adds a rule
    // that blows up on repeated punctuation, this catches it before it ships.
    const long = ("a" + ".".repeat(50)).repeat(200);
    const start = process.hrtime.bigint();
    scanForDanger(long);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(50);
  });
});
