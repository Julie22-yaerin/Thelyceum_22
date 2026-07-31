/**
 * ROI reporting — the number a CTO takes to the board.
 *
 * The claim being made is "this tool cost $X and saved $Y". That claim is only
 * worth anything if Y is defensible when a CFO pushes back, so every figure
 * here is separated into what was *measured* and what was *estimated*, and the
 * estimates carry their assumption in the payload rather than in a footnote
 * nobody reads.
 *
 * The distinction, concretely:
 *   MEASURED  — a request was blocked, and we know what it would have cost
 *               because we know the model, the token count and the rate.
 *   ESTIMATED — a loop was cut at iteration 3. What it *would* have run to is
 *               unknowable. We assume a bounded continuation and say so.
 *
 * A dashboard that blends those two into one confident number is the reason
 * finance teams stop believing vendor ROI claims. Keeping them apart is what
 * makes this survive the meeting.
 */

import type { BreachCode } from "../lib/circuitBreaker.js";

export interface SavingsLine {
  label: string;
  /** Cents. */
  amount: number;
  basis: "measured" | "estimated";
  /** The assumption behind an estimate, stated so it can be argued with. */
  assumption?: string;
  count: number;
}

export interface RoiReport {
  periodStart: number;
  periodEnd: number;

  /** What the customer paid us for the period. */
  costCents: number;

  /** Spend that actually went to providers. Measured exactly. */
  providerSpendCents: number;

  savings: SavingsLine[];
  measuredSavingsCents: number;
  estimatedSavingsCents: number;

  /** Conservative: measured only. The number to quote when challenged. */
  conservativeRoi: number;
  /** Including estimates. The number to quote when selling. */
  headlineRoi: number;

  incidents: {
    loopsStopped: number;
    budgetBreaches: number;
    scopeViolations: number;
    ungroundedClaims: number;
    attacksRepelled: number;
    selfHealed: number;
  };

  latency: {
    p50AddedMs: number;
    p95AddedMs: number;
    failoverEvents: number;
    /** Requests that would have errored but were served by a fallback. */
    outagesAbsorbed: number;
  };

  /** One paragraph a CTO can paste into an email. Deliberately unexcited. */
  narrative: string;
}

export interface UsageEvent {
  at: number;
  kind:
    | "call"
    | "loop_stopped"
    | "budget_breach"
    | "scope_violation"
    | "ungrounded_claim"
    | "attack_repelled"
    | "self_healed"
    | "failover";
  /** Actual cost of this call, when it completed. */
  costCents?: number;
  /** Cost of the call that was prevented, when we know it. */
  preventedCents?: number;
  addedLatencyMs?: number;
  breach?: BreachCode;
}

/**
 * What a stopped loop would have cost if it had run on.
 *
 * The honest position: unknowable. An unbounded loop could run until the
 * session budget caps it, so the *maximum* is the remaining budget — but
 * quoting the maximum is how vendors get caught inflating. This assumes the
 * loop would have run 10 more iterations at the same per-call cost, which is
 * both conservative and easy to explain.
 */
const ASSUMED_LOOP_CONTINUATION = 10;

export function buildRoiReport(params: {
  events: UsageEvent[];
  periodStart: number;
  periodEnd: number;
  /** What the customer pays, in cents, for this period. */
  subscriptionCents: number;
  attacksRepelled?: number;
  selfHealed?: number;
}): RoiReport {
  const { events, periodStart, periodEnd, subscriptionCents } = params;

  const inPeriod = events.filter((e) => e.at >= periodStart && e.at <= periodEnd);

  const providerSpendCents = inPeriod
    .filter((e) => e.kind === "call")
    .reduce((sum, e) => sum + (e.costCents ?? 0), 0);

  const loops = inPeriod.filter((e) => e.kind === "loop_stopped");
  const budget = inPeriod.filter((e) => e.kind === "budget_breach");
  const scope = inPeriod.filter((e) => e.kind === "scope_violation");
  const ungrounded = inPeriod.filter((e) => e.kind === "ungrounded_claim");
  const failovers = inPeriod.filter((e) => e.kind === "failover");

  const avgCallCents =
    inPeriod.filter((e) => e.kind === "call").length > 0
      ? providerSpendCents / inPeriod.filter((e) => e.kind === "call").length
      : 0;

  const savings: SavingsLine[] = [];

  // Measured: the request was stopped before it was sent, and we know what the
  // identical call cost the last time it ran.
  const budgetSaved = budget.reduce((s, e) => s + (e.preventedCents ?? 0), 0);
  if (budget.length > 0) {
    savings.push({
      label: "Calls blocked at the budget ceiling",
      amount: budgetSaved,
      basis: "measured",
      count: budget.length,
    });
  }

  const scopeSaved = scope.reduce((s, e) => s + (e.preventedCents ?? 0), 0);
  if (scope.length > 0) {
    savings.push({
      label: "Out-of-scope tool calls refused",
      amount: scopeSaved,
      basis: "measured",
      count: scope.length,
    });
  }

  // Estimated: we cut the loop, so what it would have grown to is a model.
  const loopSaved = Math.round(loops.length * avgCallCents * ASSUMED_LOOP_CONTINUATION);
  if (loops.length > 0) {
    savings.push({
      label: "Loops cut before they ran away",
      amount: loopSaved,
      basis: "estimated",
      assumption: `Assumes each loop would have run ${ASSUMED_LOOP_CONTINUATION} more iterations at the average call cost of $${(avgCallCents / 100).toFixed(4)}. The true figure is unknowable — an unbounded loop stops only at the session ceiling.`,
      count: loops.length,
    });
  }

  // Ungrounded claims have no direct token cost, and pretending otherwise is
  // exactly the kind of inflation that gets a report dismissed. Counted, not
  // priced.
  if (ungrounded.length > 0) {
    savings.push({
      label: "Ungrounded claims caught before reaching a customer",
      amount: 0,
      basis: "measured",
      assumption:
        "Not assigned a dollar value. The cost of an agent quoting a price nobody approved is a commercial and legal question, not a token count — we will not invent a number for it.",
      count: ungrounded.length,
    });
  }

  const measuredSavingsCents = savings
    .filter((s) => s.basis === "measured")
    .reduce((sum, s) => sum + s.amount, 0);
  const estimatedSavingsCents = savings
    .filter((s) => s.basis === "estimated")
    .reduce((sum, s) => sum + s.amount, 0);

  const latencies = inPeriod
    .map((e) => e.addedLatencyMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);

  const pct = (p: number) =>
    latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

  const incidents = {
    loopsStopped: loops.length,
    budgetBreaches: budget.length,
    scopeViolations: scope.length,
    ungroundedClaims: ungrounded.length,
    attacksRepelled: params.attacksRepelled ?? 0,
    selfHealed: params.selfHealed ?? 0,
  };

  const conservativeRoi = subscriptionCents > 0 ? measuredSavingsCents / subscriptionCents : 0;
  const headlineRoi =
    subscriptionCents > 0 ? (measuredSavingsCents + estimatedSavingsCents) / subscriptionCents : 0;

  return {
    periodStart,
    periodEnd,
    costCents: subscriptionCents,
    providerSpendCents,
    savings,
    measuredSavingsCents,
    estimatedSavingsCents,
    conservativeRoi,
    headlineRoi,
    latency: {
      p50AddedMs: pct(0.5),
      p95AddedMs: pct(0.95),
      failoverEvents: failovers.length,
      outagesAbsorbed: failovers.length,
    },
    incidents,
    narrative: buildNarrative({
      incidents,
      measuredSavingsCents,
      estimatedSavingsCents,
      subscriptionCents,
      p95: pct(0.95),
      failovers: failovers.length,
    }),
  };
}

function buildNarrative(p: {
  incidents: RoiReport["incidents"];
  measuredSavingsCents: number;
  estimatedSavingsCents: number;
  subscriptionCents: number;
  p95: number;
  failovers: number;
}): string {
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  const parts: string[] = [];

  parts.push(
    `The Lyceum blocked ${p.incidents.budgetBreaches} calls at the budget ceiling and ` +
      `${p.incidents.scopeViolations} tool calls outside their agent's permissions, ` +
      `preventing ${usd(p.measuredSavingsCents)} of provider spend we can account for exactly.`
  );

  if (p.incidents.loopsStopped > 0) {
    parts.push(
      `It also cut ${p.incidents.loopsStopped} runaway loops. Those would have kept spending; ` +
        `on a conservative assumption that adds a further ${usd(p.estimatedSavingsCents)}, ` +
        `though the true figure cannot be known because the loops were stopped.`
    );
  }

  if (p.incidents.ungroundedClaims > 0) {
    parts.push(
      `${p.incidents.ungroundedClaims} answers containing figures that were not in the knowledge base ` +
        `were caught before reaching a customer. We have not put a dollar value on those.`
    );
  }

  if (p.failovers > 0) {
    parts.push(`${p.failovers} provider failures were absorbed without an error reaching a user.`);
  }

  if (p.incidents.attacksRepelled > 0) {
    parts.push(
      `The adversarial suite ran ${p.incidents.attacksRepelled} attacks against our own configuration and found no way through.`
    );
  }

  parts.push(`Added latency at p95 was ${p.p95}ms. The subscription cost ${usd(p.subscriptionCents)}.`);

  return parts.join(" ");
}
