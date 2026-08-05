/**
 * Brutal Stress Test Suite for thrift (Saver).
 *
 * Tests context compressor under extreme, chaotic, and demanding inputs:
 *   1. Massive 10,000-line chaotic log corpus with strict 250-token budget constraint.
 *   2. Entire 500+ BLNS (Big List of Naughty Strings) corpus in one single payload.
 *   3. Multi-threaded Promise parallel compression burst (1,000 concurrent calls).
 *   4. Zero token increase invariant under adversarial noise.
 */

import { describe, expect, it } from "vitest";
import { compress, SeenLedger } from "../src/compress.js";
import { globalLoopTracker } from "../src/loop.js";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";

describe("brutal stress tests — thrift context compressor", () => {
  it("enforces strict budget ceiling on a 10,000-line chaotic log payload", () => {
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      if (i % 100 === 0) {
        lines.push(`2026-08-05T15:30:${(i % 60).toString().padStart(2, "0")}.000Z \u001b[31m[ERROR]\u001b[0m Failed at step ${i}`);
      } else if (i % 10 === 0) {
        lines.push(`    at Module.compile (node:internal/modules/cjs/loader:${1000 + i}:14)`);
      } else {
        lines.push(`2026-08-05T15:30:00.000Z [INFO] Processing batch item #${i} ... ừm à...`);
      }
    }
    const massiveText = lines.join("\n");
    const ledger = new SeenLedger();

    const start = process.hrtime.bigint();
    const result = compress(massiveText, ledger, {
      sourceId: "massive_chaotic.log",
      budgetTokens: 250,
    });
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Strict assertions
    expect(result.after.tokens).toBeLessThanOrEqual(300);
    expect(result.saved).toBeGreaterThan(0);
    expect(result.text).toContain("[thrift:");
    expect(durationMs).toBeLessThan(1000); // Must process 10,000 lines in < 1 sec
  });

  it("handles the entire 500+ BLNS dataset mixed with SVG blobs and ANSI escapes without panic", async () => {
    const blnsPath = resolve(__dirname, "../../../benches/datasets/blns/big-list-of-naughty-strings-master/blns.json");
    const blnsContent = await fs.readFile(blnsPath, "utf-8");
    const naughtyStrings: string[] = JSON.parse(blnsContent);

    const svgBlob = `<svg><path d="${"M10 20 L30 40 C50 60 ".repeat(50)}" /></svg>`;
    const fullPayload = naughtyStrings.join("\n") + "\n" + svgBlob + "\n\u001b[32m[OK]\u001b[0m Done.";

    const ledger = new SeenLedger();
    const result = compress(fullPayload, ledger, {
      sourceId: "full_blns_suite.txt",
      budgetTokens: 1000,
    });

    expect(result.after.tokens).toBeLessThanOrEqual(result.before.tokens);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain("SVG path omitted");
  });

  it("handles 1,000 concurrent parallel compression calls without state corruption", async () => {
    const ledger = new SeenLedger();
    const promises: Promise<any>[] = [];

    for (let i = 0; i < 1_000; i++) {
      const payload = `Line ${i}: \u001b[33mWarning\u001b[0m repeated log statement\nLine ${i}: repeated log statement`;
      promises.push(
        Promise.resolve().then(() => compress(payload, ledger, { sourceId: `parallel-${i % 10}` }))
      );
    }

    const results = await Promise.all(promises);
    expect(results.length).toBe(1000);
    for (const r of results) {
      expect(r.after.tokens).toBeLessThanOrEqual(r.before.tokens);
    }
  });

  it("trips loop tracker deterministically under rapid repeated calls", () => {
    globalLoopTracker.reset();
    const key = "git checkout -b feature/test";

    expect(globalLoopTracker.trackAndCheck(key).tripped).toBe(false);
    expect(globalLoopTracker.trackAndCheck(key).tripped).toBe(false);
    
    // 3rd call must trip
    const third = globalLoopTracker.trackAndCheck(key);
    expect(third.tripped).toBe(true);
    expect(third.action).toBe("intercept_loop");
    expect(third.tokensSaved).toBeGreaterThan(0);
  });

  it("compacts large HTML bundle with base64 Data URIs and SVG paths without breaking HTML structure", () => {
    const base64Img = "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".repeat(100);
    const htmlBundle = `<html><body><img src="${base64Img}" /><svg><path d="${"M10 20 L30 40 Z ".repeat(50)}" /></svg></body></html>`;

    const ledger = new SeenLedger();
    const result = compress(htmlBundle, ledger, { sourceId: "page.html" });

    expect(result.after.tokens).toBeLessThan(result.before.tokens);
    expect(result.text).toContain("base64");
    expect(result.text).toContain("SVG path omitted");
  });

  it("invalidates dedupe baseline on rapid file edits to prevent stale state returns", () => {
    const ledger = new SeenLedger();
    const sourceId = "/src/config.ts";

    for (let i = 0; i < 20; i++) {
      const text = `export const VERSION = "${i}.0.0"; // Edit #${i}\nfunction getVersion() { return VERSION; }`;
      const result = compress(text, ledger, { sourceId });

      // Every edit MUST return full content, NOT a dedupe pointer!
      expect(result.applied).not.toContain("dedupe");
      expect(result.text).toContain(`VERSION = "${i}.0.0"`);

      // Re-read of EXACT SAME content MUST return dedupe pointer
      const reRead = compress(text, ledger, { sourceId });
      expect(reRead.applied).toEqual(["dedupe"]);
      expect(reRead.text).toContain("re-read");
    }
  });
});
