/**
 * Usage tracking — the budget dashboard's data layer.
 *
 * The properties worth protecting: usage aggregates per user per month (one
 * user's reports never leak into another's), the month column makes the
 * budget roll over without a cleanup job, and budgetStatus moves through
 * ok → warn → over at the BUDGET_WARN_PCT and 100% boundaries.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../src/db.js";
import { signup } from "../src/auth.js";
import { recordUsage, monthlyUsage, budgetStatus, monthKey } from "../src/usage.js";
import { BUDGET_WARN_PCT, type PlanId } from "../src/plans.js";

const SECRET = "test-secret-for-usage";

let dir: string;
let db: DbHandle;
let userA: string;
let userB: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-usage-test-"));
  db = openDb(join(dir, "test.db"));
  userA = signup(db, SECRET, { email: "a@corp.io", password: "password-123" }).user.id;
  userB = signup(db, SECRET, { email: "b@corp.io", password: "password-123" }).user.id;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("recordUsage + monthlyUsage", () => {
  it("aggregates reports into a single row per (user, month, tool, kind)", () => {
    recordUsage(db, userA, { tool: "thrift", kind: "measure", tokens: 1000, calls: 5 });
    recordUsage(db, userA, { tool: "thrift", kind: "measure", tokens: 2000, calls: 3 });
    const usage = monthlyUsage(db, userA);
    expect(usage.tokens).toBe(3000);
    expect(usage.calls).toBe(8);
    expect(usage.byTool.thrift.tokens).toBe(3000);
  });

  it("keeps users' usage isolated", () => {
    recordUsage(db, userA, { tool: "thrift", kind: "measure", tokens: 9999, calls: 1 });
    const usageB = monthlyUsage(db, userB);
    expect(usageB.tokens).toBe(0);
    expect(usageB.calls).toBe(0);
    expect(usageB.byTool.thrift.tokens).toBe(0);
  });

  it("separates tools in the breakdown", () => {
    recordUsage(db, userA, { tool: "brake", kind: "scan", tokens: 100, calls: 1 });
    recordUsage(db, userA, { tool: "redteam", kind: "challenge", tokens: 50, calls: 1 });
    const usage = monthlyUsage(db, userA);
    expect(usage.byTool.brake.tokens).toBe(100);
    expect(usage.byTool.redteam.tokens).toBe(50);
    expect(usage.byTool.thrift.tokens).toBe(0);
  });

  it("a report of zero tokens and zero calls records nothing", () => {
    recordUsage(db, userA, { tool: "brake", kind: "scan", tokens: 0, calls: 0 });
    expect(monthlyUsage(db, userA).tokens).toBe(0);
  });

  it("clamps absurd values instead of storing them", () => {
    recordUsage(db, userA, { tool: "thrift", kind: "measure", tokens: 1e18, calls: 1e18 });
    const usage = monthlyUsage(db, userA);
    expect(usage.tokens).toBe(1_000_000_000_000); // the clamp ceiling
    expect(usage.calls).toBe(1_000_000_000);
  });
});

describe("monthKey", () => {
  it("is YYYY-MM in UTC", () => {
    // A date that is the 1st of the next month in some timezones, to prove UTC.
    expect(monthKey(Date.UTC(2026, 0, 1))).toBe("2026-01");
    expect(monthKey(Date.UTC(2026, 11, 31, 23, 59, 59))).toBe("2026-12");
  });
});

describe("budgetStatus", () => {
  const solo: PlanId = "solo";

  it("is ok below the warn threshold", () => {
    const usage = { month: "2026-01", tokens: 1_000, calls: 10, byTool: {} as never };
    const s = budgetStatus(solo, usage);
    expect(s.status).toBe("ok");
    expect(s.pct).toBeLessThan(BUDGET_WARN_PCT);
    expect(s.remainingTokens).toBeGreaterThan(0);
  });

  it("warns at or above BUDGET_WARN_PCT", () => {
    // Solo budget is 50M; 80% = 40M.
    const usage = { month: "2026-01", tokens: 40_000_000, calls: 0, byTool: {} as never };
    expect(budgetStatus(solo, usage).status).toBe("warn");
  });

  it("goes over at 100% and floors remaining at zero", () => {
    const usage = { month: "2026-01", tokens: 50_000_000, calls: 0, byTool: {} as never };
    const s = budgetStatus(solo, usage);
    expect(s.status).toBe("over");
    expect(s.remainingTokens).toBe(0);
  });

  it("reports the plan's budget figure", () => {
    const usage = { month: "2026-01", tokens: 0, calls: 0, byTool: {} as never };
    expect(budgetStatus("scale", usage).budgetTokens).toBe(1_000_000_000);
  });
});
