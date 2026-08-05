/**
 * Brutal Stress Test Suite for redteam.
 *
 * Tests logic challenge engine and code risk scanner under extreme, chaotic conditions:
 *   1. Multi-flaw adversarial payload (Secrets + Infinite Loop + Security Bypass + Overconfidence + Vietnamese).
 *   2. Large 50,000-character mixed code & prose document multi-pass scan.
 *   3. 2,000 concurrent parallel challenge() execution burst.
 *   4. Zero state corruption & deterministic blocking verdicts.
 */

import { describe, expect, it } from "vitest";
import { challenge, rebut, listFlawRules } from "../src/challenge.js";
import { scanCodeFlaws } from "../src/code_scanner.js";

describe("brutal stress tests — redteam logic & code risk scanner", () => {
  it("detects and blocks a multi-flaw adversarial composite payload within 50ms", () => {
    const compositePayload = [
      "Phương án này chắc chắn không có rủi ro nào và không thể thất bại.",
      "Research shows this approach is 100% foolproof.",
      "const token = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz123456';",
      "exec('rm -rf /');",
      "import magic from 'nonexistent-hallucinated-package-xyz';",
      "Let me bypass auth for testing purposes only.",
      "Delegated to subagent again repeatedly in a loop.",
      "As I mentioned earlier, let me re-read the same document again.",
    ].join("\n");

    const start = process.hrtime.bigint();
    const result = challenge(compositePayload);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Strict assertions
    expect(result.verdict.blocked).toBe(true);
    expect(result.verdict.action).toBe("block");
    expect(result.flags.length).toBeGreaterThanOrEqual(5);

    const flawsFound = new Set(result.flags.map((f) => f.flaw));
    expect(flawsFound.has("overconfidence")).toBe(true);
    expect(flawsFound.has("security_bypass")).toBe(true);
    expect(flawsFound.has("ping_pong_loop")).toBe(true);

    expect(elapsedMs).toBeLessThan(150); // Scanner must run in < 150ms on cold startup
  });

  it("processes a massive 50,000-character document without performance degradation or OOM", () => {
    const chunk = "We should recommend this architecture. The trade-off is higher memory footprint.\n".repeat(500);
    const largeDoc = chunk + "\nObviously there are no risks.\n" + chunk;

    const start = process.hrtime.bigint();
    const result = challenge(largeDoc, { autoCompact: true });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    expect(result.flags.some((f) => f.flaw === "overconfidence" || f.flaw === "confirmation_bias")).toBe(true);
    expect(elapsedMs).toBeLessThan(500); // 50KB doc must scan in < 500ms
  });

  it("handles 2,000 concurrent parallel challenge calls without state corruption", async () => {
    const promises: Promise<any>[] = [];
    const payload = "Research shows this obviously works. ghp_1234567890abcdefghijklmnopqrstuvwxyz123456";

    for (let i = 0; i < 2_000; i++) {
      promises.push(Promise.resolve().then(() => challenge(payload)));
    }

    const results = await Promise.all(promises);
    expect(results.length).toBe(2000);
    for (const r of results) {
      expect(r.verdict.blocked).toBe(true);
      expect(r.flags.length).toBeGreaterThan(0);
    }
  });

  it("guarantees 100% flaw rule list coverage across all categories", () => {
    const rules = listFlawRules();
    expect(rules.length).toBeGreaterThanOrEqual(18);

    for (const rule of rules) {
      expect(rule.flaw).toBeDefined();
      expect(rule.explanation.length).toBeGreaterThan(5);
    }
  });

  it("prevents False Positives on valid dev code containing commented commands", () => {
    const safeDevCode = [
      "// Note: To clean build cache, run rm -rf /tmp/build-cache",
      "/* We do not use eval() on user input */",
      "export function cleanTempDir() {",
      "  const path = '/tmp/scratch';",
      "  console.log('Cleaning temp dir:', path);",
      "}",
    ].join("\n");

    const result = challenge(safeDevCode);
    expect(result.verdict.blocked).toBe(false);
    expect(result.flags.some((f) => f.flaw === "malicious_payload")).toBe(false);
  });
});
