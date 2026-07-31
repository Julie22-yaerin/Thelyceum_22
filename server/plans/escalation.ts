/**
 * Runtime escalation — what happens when a plan meets reality.
 *
 * A plan is approved for what it said it would do. The moment execution
 * deviates, someone has to decide whether that deviation is fine. This module
 * answers that with three outcomes and no fourth:
 *
 *   OFFICER   an AI officer decides, because the deviation is small AND the
 *             workspace granted that permission. Logged either way.
 *   HUMAN     the deviation is material. Execution pauses and waits.
 *   RED_ALERT the agent is about to do something dangerous. Everything stops,
 *             the operator's screen is taken over, and nothing resumes until
 *             they choose.
 *
 * The 40% line is the operator's, set in settings, and the officer never
 * decides above it however confident it is. That is the whole point of having
 * a line: it binds the confident case, not just the uncertain one.
 *
 * RED_ALERT is not on the risk scale at all. Data exfiltration and attacking
 * infrastructure are not "high risk deviations" to be weighed against speed —
 * they are categorically different, and treating them as a number on the same
 * axis is how a sufficiently confident agent argues its way past them.
 */

import type { StepRisk } from "./lifecycle.js";

export type DangerClass =
  | "data_exfiltration"
  | "infrastructure_attack"
  | "credential_access"
  | "destructive_operation"
  | "financial_movement"
  | "impersonation";

export interface DangerSignal {
  danger: DangerClass;
  /** What was observed, quoted so the operator can judge it themselves. */
  evidence: string;
  /** Plain-language explanation for the alert screen. */
  explanation: string;
}

/**
 * Patterns that trigger a red alert.
 *
 * Deliberately narrow and anchored to syntax or explicit intent. A pattern that
 * fires on ordinary work would train the operator to dismiss the full-screen
 * alert, and a dismissed alert protects nothing — the false-positive cost here
 * is much higher than for a normal guard.
 */
const DANGER_RULES: { danger: DangerClass; pattern: RegExp; explanation: string }[] = [
  {
    danger: "data_exfiltration",
    pattern: /\b(?:send|upload|post|export|sync|forward)\b[^.\n]{0,60}\b(?:all|entire|every|full|whole)\b[^.\n]{0,40}\b(?:customer|user|client|contact|record|database|table)s?\b/i,
    explanation:
      "The agent is preparing to move a bulk customer or user dataset to somewhere outside this system.",
  },
  {
    danger: "data_exfiltration",
    pattern: /\b(?:curl|fetch|axios|requests\.(?:post|put))\b[^\n]{0,80}https?:\/\/(?!(?:localhost|127\.0\.0\.1))/i,
    explanation: "The agent is preparing to send data to an external address that was not in the approved plan.",
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:nmap|sqlmap|metasploit|hydra|nikto|masscan)\b|\bport\s?scan\b|\bbrute[\s-]?forc\w+\b|\b(?:ddos|dos)\s+(?:attack|the)\b/i,
    explanation:
      "The agent is preparing to run a network attack or scanning tool. This is never part of legitimate work here.",
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:union\s+select|drop\s+table|;\s*--|or\s+1\s*=\s*1)\b/i,
    explanation: "The agent's output contains SQL injection syntax.",
  },
  {
    danger: "credential_access",
    pattern: /\b(?:read|print|dump|reveal|show|exfiltrate)\b[^.\n]{0,40}\b(?:api[_\s-]?key|secret|credential|password|token|\.env|private[_\s-]?key)s?\b/i,
    explanation: "The agent is preparing to read or reveal credentials.",
  },
  {
    danger: "destructive_operation",
    pattern: /\b(?:rm\s+-rf|drop\s+database|truncate\s+table|delete\s+from\s+\w+\s*(?:;|$))/i,
    explanation: "The agent is preparing an operation that destroys data irreversibly.",
  },
  {
    danger: "financial_movement",
    pattern: /\b(?:transfer|wire|send|withdraw|charge)\b[^.\n]{0,40}\b(?:funds|money|payment|balance|\$[\d,]+)\b/i,
    explanation: "The agent is preparing to move money.",
  },
  {
    danger: "impersonation",
    pattern: /\b(?:sign|send|post|publish)\b[^.\n]{0,40}\bas\s+(?:the\s+)?(?:ceo|cto|founder|owner|admin)\b/i,
    explanation: "The agent is preparing to act under someone else's identity.",
  },
];

/**
 * Scan an intended action for danger.
 *
 * Runs BEFORE the action, on what the agent says it is about to do. Detecting
 * exfiltration after the data has left is an incident report, not a control.
 */
export function scanForDanger(intent: string): DangerSignal | null {
  for (const rule of DANGER_RULES) {
    const match = intent.match(rule.pattern);
    if (match) {
      return {
        danger: rule.danger,
        evidence: match[0].slice(0, 200),
        explanation: rule.explanation,
      };
    }
  }
  return null;
}

// ── Escalation policy ────────────────────────────────────────────────────────

export interface EscalationPolicy {
  /**
   * Whether an AI officer may decide small deviations alone. Off by default:
   * the operator opts into delegated judgement, they do not inherit it.
   */
  officerMayDecide: boolean;
  /** Deviations assessed at or above this go to a human. Operator's number. */
  humanThresholdPercent: number;
  /** Emergency brake must engage within this. Measured, not asserted. */
  brakeSlaMs: number;
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  officerMayDecide: false,
  humanThresholdPercent: 40,
  brakeSlaMs: 1000,
};

export interface Deviation {
  planId: string;
  stepId: string;
  agentId: string;
  /** What the plan said. */
  expected: string;
  /** What the agent now wants to do. */
  actual: string;
  /** Cost delta in cents, if any. */
  extraCents?: number;
  /** Risk of the step as approved. */
  approvedRisk: StepRisk;
}

export interface EscalationDecision {
  route: "officer" | "human" | "red_alert";
  riskPercent: number;
  reason: string;
  danger?: DangerSignal;
  /** Present when the officer decided, for the audit trail. */
  officerVerdict?: "proceed" | "skip";
}

/**
 * Score how far execution has drifted from what was approved.
 *
 * Deterministic and explainable. The operator has to be able to read why
 * something was escalated or wasn't; a model's opinion of its own deviation is
 * not auditable.
 */
export function assessDeviation(dev: Deviation): { percent: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;

  // Approved risk carries forward: deviating on a step that was already
  // high-risk is worse than the same drift on a trivial one.
  const riskBase = { low: 0.1, medium: 0.25, high: 0.5 }[dev.approvedRisk];
  score += riskBase;
  factors.push(`Step was approved as ${dev.approvedRisk} risk.`);

  // Cost overrun. A step that costs more than planned is the most common
  // deviation and the easiest to reason about.
  const extra = dev.extraCents ?? 0;
  if (extra > 0) {
    const costScore = Math.min(0.3, extra / 1000); // $10 extra = full weight
    score += costScore;
    factors.push(`Costs $${(extra / 100).toFixed(2)} more than planned.`);
  }

  // Textual divergence. Crude on purpose — a precise semantic diff would be a
  // model call, which puts a model in the loop of deciding whether to escalate
  // to a human, which is the wrong place for one.
  const expected = new Set(dev.expected.toLowerCase().split(/\W+/).filter(Boolean));
  const actual = dev.actual.toLowerCase().split(/\W+/).filter(Boolean);
  const overlap = actual.filter((w) => expected.has(w)).length / Math.max(actual.length, 1);
  const divergence = 1 - overlap;
  score += divergence * 0.35;
  factors.push(
    divergence > 0.6
      ? "What it wants to do barely resembles the approved step."
      : `Roughly ${Math.round(divergence * 100)}% different from the approved step.`
  );

  return { percent: Math.min(100, Math.round(score * 100)), factors };
}

/**
 * Route a deviation.
 *
 * Danger is checked first and short-circuits everything. It is not weighed
 * against risk percentage, not subject to the officer permission, and not
 * affected by how confident anyone is.
 */
export function routeDeviation(params: {
  deviation: Deviation;
  policy: EscalationPolicy;
  /** What the agent says it will do — scanned for danger. */
  intent: string;
}): EscalationDecision {
  const danger = scanForDanger(params.intent);
  if (danger) {
    return {
      route: "red_alert",
      riskPercent: 100,
      danger,
      reason:
        `${danger.explanation} This is not a judgement call — everything is stopped until a person decides.`,
    };
  }

  const { percent, factors } = assessDeviation(params.deviation);

  if (!params.policy.officerMayDecide) {
    return {
      route: "human",
      riskPercent: percent,
      reason: `Delegated decisions are off for this workspace, so every deviation waits for you. ${factors.join(" ")}`,
    };
  }

  if (percent >= params.policy.humanThresholdPercent) {
    return {
      route: "human",
      riskPercent: percent,
      reason: `Assessed at ${percent}%, at or above your ${params.policy.humanThresholdPercent}% line. ${factors.join(" ")}`,
    };
  }

  return {
    route: "officer",
    riskPercent: percent,
    officerVerdict: "proceed",
    reason: `Assessed at ${percent}%, below your ${params.policy.humanThresholdPercent}% line. The officer allowed it and logged why. ${factors.join(" ")}`,
  };
}

// ── Emergency brake ──────────────────────────────────────────────────────────

export interface BrakeResult {
  engaged: boolean;
  /** Measured, so the SLA is a fact rather than a claim. */
  elapsedMs: number;
  withinSla: boolean;
  stopped: { agents: number; plans: number };
}

/**
 * Stop everything, now.
 *
 * The SLA is measured and reported even when missed. A brake that quietly took
 * 3 seconds while the UI said "1000ms SLA" is worse than no brake, because the
 * operator would have acted differently had they known.
 */
export async function engageBrake(params: {
  licenseKey: string;
  reason: string;
  policy?: EscalationPolicy;
  /** Injected so this module has no opinion about storage. */
  stopAll: () => Promise<{ agents: number; plans: number }>;
}): Promise<BrakeResult> {
  const started = Date.now();
  const sla = (params.policy ?? DEFAULT_ESCALATION).brakeSlaMs;

  let stopped = { agents: 0, plans: 0 };
  try {
    stopped = await params.stopAll();
  } catch {
    // A brake that throws is a brake that did not engage. Report it as such
    // rather than letting the exception look like success upstream.
    const elapsedMs = Date.now() - started;
    return { engaged: false, elapsedMs, withinSla: false, stopped };
  }

  const elapsedMs = Date.now() - started;
  return { engaged: true, elapsedMs, withinSla: elapsedMs <= sla, stopped };
}
