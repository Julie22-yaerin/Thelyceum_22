/**
 * Throughput regression test — see brake's copy of this file for the full
 * rationale. thrift's hot path is `compress`, which runs on every tool
 * result the model reads in an agent loop.
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
    for (let i = 0; i < 5_000; i++) {
      compress(CORPUS[i % CORPUS.length], new SeenLedger(), { sourceId: `s${i}`, budgetTokens: 4000 });
    }

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
    expect(bestCallsPerSec).toBeGreaterThan(5_000);
  }, 20000);

  it("does not degrade badly on a long adversarial-looking input", () => {
    const long = "a".repeat(80) + "\n" + "\u001b[0m" + "x".repeat(5000) + "\n" + "y".repeat(80) + "\n";
    const start = process.hrtime.bigint();
    compress(long.repeat(50), new SeenLedger(), { sourceId: "long", budgetTokens: 4000 });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeLessThan(15000);
  }, 20000);
});
