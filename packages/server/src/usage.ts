/**
 * Usage tracking — the budget dashboard's data layer.
 *
 * The CLIs report what they processed (best-effort, off the hot path — see
 * each CLI's usage reporter), and this module stores it per user per month
 * and answers the one question the dashboard asks: "how much of this month's
 * token budget has this account used, and is it time to worry?"
 *
 * ── Why tokens ─────────────────────────────────────────────────────────────
 * The budget is a TOKEN budget because that is the unit every tool can speak
 * in: thrift reports real tokens it processed (beforeTokens across the run),
 * brake and redteam estimate the tokens of the text they scanned. Calls are
 * tracked alongside as a second, tool-agnostic measure of activity, but the
 * budget bar is driven by tokens — a runaway agent burns tokens, not calls.
 *
 * ── Month rollover ──────────────────────────────────────────────────────────
 * Each row carries a `month` column (YYYY-MM, UTC). The current month's usage
 * is a single indexed range scan, and at month end the budget simply refers
 * to a new month with a zero total — no cleanup job, no reset endpoint.
 */

import { randomUUID } from "node:crypto";
import type { DbHandle } from "./db.js";
import { getPlan, BUDGET_WARN_PCT, type PlanId } from "./plans.js";

export type ToolId = "brake" | "redteam" | "thrift";

export interface UsageReportInput {
  tool: ToolId;
  kind: string;
  tokens?: number;
  calls?: number;
}

export interface MonthlyUsage {
  month: string;
  tokens: number;
  calls: number;
  /** Per-tool totals, for the dashboard's breakdown. */
  byTool: Record<ToolId, { tokens: number; calls: number }>;
}

export interface BudgetStatus {
  month: string;
  plan: PlanId;
  budgetTokens: number;
  usedTokens: number;
  calls: number;
  /** 0..1+, clamped display value; can exceed 1 when over budget. */
  pct: number;
  status: "ok" | "warn" | "over";
  remainingTokens: number;
}

/** Current UTC month as YYYY-MM. Overridable for tests. */
export function monthKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Guard values so a buggy or hostile client cannot store absurd numbers. */
function clamp(n: number | undefined, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(Math.floor(n), max));
}

/**
 * Record one usage report. Aggregates into a single row per (user, month) —
 * the CLIs may report many times a day, and a row per report would make the
 * table unbounded. Idempotent in effect: reporting twice adds twice, which
 * is correct for two real events.
 */
export function recordUsage(db: DbHandle, userId: string, input: UsageReportInput): void {
  const tokens = clamp(input.tokens, 1_000_000_000_000);
  const calls = clamp(input.calls, 1_000_000_000);
  if (tokens === 0 && calls === 0) return; // nothing to record

  const month = monthKey();
  // Atomic upsert on (user_id, month, tool, kind): two CLIs reporting the
  // same bucket in the same instant cannot race to a duplicate row — one
  // INSERTs, the other's conflict clause accumulates onto it. No lost reports.
  db.raw
    .prepare(
      `INSERT INTO usage (id, user_id, tool, kind, tokens, calls, month, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, month, tool, kind)
       DO UPDATE SET tokens = tokens + excluded.tokens,
                     calls = calls + excluded.calls,
                     created_at = excluded.created_at`
    )
    .run(randomUUID(), userId, input.tool, input.kind, tokens, calls, month, Date.now());
}

/** Total usage for one user in one month (defaults to the current month). */
export function monthlyUsage(db: DbHandle, userId: string, month = monthKey()): MonthlyUsage {
  const rows = db.raw
    .prepare("SELECT tool, SUM(tokens) AS tokens, SUM(calls) AS calls FROM usage WHERE user_id = ? AND month = ? GROUP BY tool")
    .all(userId, month) as unknown as { tool: ToolId; tokens: number; calls: number }[];

  const byTool: MonthlyUsage["byTool"] = { brake: { tokens: 0, calls: 0 }, redteam: { tokens: 0, calls: 0 }, thrift: { tokens: 0, calls: 0 } };
  let tokens = 0;
  let calls = 0;
  for (const row of rows) {
    byTool[row.tool] = { tokens: row.tokens, calls: row.calls };
    tokens += row.tokens;
    calls += row.calls;
  }
  return { month, tokens, calls, byTool };
}

/**
 * Where this user sits against their plan's monthly budget.
 *
 * Status: ok below BUDGET_WARN_PCT, warn at or above it, over at or above
 * 100%. `remainingTokens` floors at zero — going over is reported as over,
 * not as a negative remaining.
 */
export function budgetStatus(plan: PlanId, usage: MonthlyUsage): BudgetStatus {
  const budgetTokens = getPlan(plan).monthlyTokenBudget;
  const pct = budgetTokens > 0 ? usage.tokens / budgetTokens : usage.tokens > 0 ? 1 : 0;
  const status: BudgetStatus["status"] = pct >= 1 ? "over" : pct >= BUDGET_WARN_PCT ? "warn" : "ok";
  return {
    month: usage.month,
    plan,
    budgetTokens,
    usedTokens: usage.tokens,
    calls: usage.calls,
    pct,
    status,
    remainingTokens: Math.max(0, budgetTokens - usage.tokens),
  };
}
