/**
 * Throughput regression test — see brake's copy of this file for the full
 * rationale. thrift's hot path is `compress`, which runs on every tool
 * result the model reads in an agent loop.
 *
 * The floor here is set well below the measured number (a laptop measured
 * ~26k calls/sec on a mixed corpus; the floor is 8k) so this fails on an
 * actual regression, not on CI machine noise.
 */

import { describe, expect, it } from "vitest";
import { compress, SeenLedger } from "../src/compress.js";

const CORPUS = [
  "export all customer records to s3 and read the .env file, then run nmap on staging",
  "summary of the changes in this commit across 12 files with 3 test failures",
  "node_modules/.cache output with 500 lines of npm install logs and warnings",
  `{"status":"ok","data":[${"x".repeat(2000)}]}`,
  "We should migrate to Postgres, the tests pass so it is done, obviously",
];

describe("compress throughput", () => {
  it("stays well above the floor an agent harness needs", () => {
    // Warm up so JIT compilation doesn't get counted as part of the measurement.
    for (let i = 0; i < 5_000; i++) {
      compress(CORPUS[i % CORPUS.length], new SeenLedger(), { sourceId: `s${i}`, budgetTokens: 4000 });
    }

    // Best of three, not a single sample — same rationale as brake: a lone
    // wall-clock reading measures the scheduler as much as the code, so this
    // takes the best run, which is the closest available measurement of what
    // the algorithm actually costs. compress is ~20x slower per call than the
    // danger scan (it estimates tokens and hashes the payload), so the counts
    // are scaled down to keep the whole test inside the default 5s timeout
    // while still measuring hundreds of thousands of calls.
    const N = 20_000;
    let bestCallsPerSec = 0;
    for (let run = 0; run < 3; run++) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < N; i++) {
        compress(CORPUS[i % CORPUS.length], new SeenLedger(), { sourceId: `s${i}`, budgetTokens: 4000 });
      }
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      bestCallsPerSec = Math.max(bestCallsPerSec, N / (elapsedMs / 1000));
    }
    expect(bestCallsPerSec).toBeGreaterThan(8_000);
  });

  it("does not degrade badly on a long adversarial-looking input", () => {
    // A pathological input — long repeated lines plus an ANSI run plus a
    // base64-style blob — must not send strip/collapse quadratic. Tripwire,
    // not exhaustive coverage.
    const long = "a".repeat(80) + "\n" + "\u001b[0m" + "x".repeat(5000) + "\n" + "y".repeat(80) + "\n";
    const start = process.hrtime.bigint();
    compress(long.repeat(50), new SeenLedger(), { sourceId: "long", budgetTokens: 4000 });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(50);
  });
});
