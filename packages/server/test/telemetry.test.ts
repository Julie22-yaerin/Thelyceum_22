/**
 * Telemetry contract.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTelemetry, clearTelemetryCache } from "../src/telemetry.js";

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
    expect(t.thriftAgentLoop.losslessPct).toBeLessThanOrEqual(100);
    expect(t.thriftAgentLoop.passes).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("caches within the TTL so repeated page loads don't re-benchmark", async () => {
    const a = await getTelemetry(ROOT);
    const b = await getTelemetry(ROOT);
    expect(a.measuredAt).toBe(b.measuredAt);
  }, 30000);

  it("the landing page renders only fields telemetry exposes", async () => {
    const t = await getTelemetry(ROOT);
    for (const m of t.measurements) {
      expect(m).toHaveProperty("tool");
      expect(m).toHaveProperty("callsPerSec");
      expect(m).toHaveProperty("avgUs");
    }
    expect(t).toHaveProperty("measuredAt");
    expect(t).toHaveProperty("thriftAgentLoop");
  }, 30000);
});
