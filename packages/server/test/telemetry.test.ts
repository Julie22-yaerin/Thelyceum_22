/**
 * Telemetry contract.
 *
 * The landing page's three numbers come from /api/telemetry, which measures
 * the actual guards on the server. The contract worth protecting: the shape
 * the page renders, and the guarantee that a benchmark failure degrades to
 * the reference fallback instead of an error or a fabricated number.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTelemetry, clearTelemetryCache } from "../src/telemetry.js";

// ESM has no __dirname — same pattern index.ts uses.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(() => clearTelemetryCache());

describe("getTelemetry", () => {
  it("returns the three measurements plus the thrift agent-loop split", async () => {
    const t = await getTelemetry(ROOT);
    expect(t.measurements).toHaveLength(3);
    expect(t.measurements.map((m) => m.tool)).toEqual(["brake", "redteam", "thrift"]);

    for (const m of t.measurements) {
      expect(m.callsPerSec).toBeGreaterThan(0);
      expect(m.avgUs).toBeGreaterThan(0);
      expect(m.label.length).toBeGreaterThan(0);
    }

    expect(t.thriftAgentLoop.savedPct).toBeGreaterThanOrEqual(0);
    expect(t.thriftAgentLoop.losslessPct).toBeGreaterThanOrEqual(0);
    // A lossless share above 100% is structurally impossible; a negative one
    // would mean thrift made things bigger. Both would be a bug worth failing on.
    expect(t.thriftAgentLoop.losslessPct).toBeLessThanOrEqual(100);
    expect(t.thriftAgentLoop.passes).toBeGreaterThanOrEqual(1);
  });

  it("caches within the TTL so repeated page loads don't re-benchmark", async () => {
    const a = await getTelemetry(ROOT);
    const b = await getTelemetry(ROOT);
    expect(a.measuredAt).toBe(b.measuredAt);
  });

  it("the landing page renders only fields telemetry exposes", async () => {
    // Regression guard for the frontend: if someone renames a field, the page
    // breaks silently (shows nothing). The JS reads these exact keys.
    const t = await getTelemetry(ROOT);
    for (const m of t.measurements) {
      expect(m).toHaveProperty("tool");
      expect(m).toHaveProperty("callsPerSec");
      expect(m).toHaveProperty("avgUs");
    }
    expect(t).toHaveProperty("measuredAt");
    expect(t).toHaveProperty("thriftAgentLoop");
  });
});
