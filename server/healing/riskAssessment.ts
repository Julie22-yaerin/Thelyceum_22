/**
 * Risk assessment — what the healer must know about itself before acting.
 *
 * A system that rewrites its own prompts needs an honest answer to "how likely
 * am I to make this worse?" before it is allowed to. Without that, self-healing
 * is just an unsupervised process editing production at 3am.
 *
 * The gate has two locks and both must open:
 *
 *   1. The operator turned autonomous healing on. Off by default. A capability
 *      this consequential should never arrive switched on because someone
 *      upgraded.
 *   2. The healer's own risk estimate is below the threshold. Above it, the
 *      fix is still generated and still tested — the operator gets a prepared
 *      patch and a one-click apply, rather than a surprise.
 *
 * The estimate is deterministic, not a model's opinion of itself. Asking an LLM
 * "how risky is your change?" produces a confident number with no relationship
 * to outcomes. These factors are things we can actually observe: how well the
 * fix is understood, how much of the prompt it touches, how much traffic it
 * would affect, whether this prompt has been healed before.
 */

import type { FailureKind, Incident } from "./incidents.js";

export interface RiskFactor {
  name: string;
  /** 0–1 contribution to overall risk. */
  weight: number;
  score: number;
  /** Why this factor scored the way it did, for the operator. */
  reason: string;
}

export interface RiskAssessment {
  /** 0–100. Below the threshold and enabled, the healer may act alone. */
  riskPercent: number;
  factors: RiskFactor[];
  /** Plain-language verdict shown on the decision card. */
  verdict: string;
  /** What the healer believes it can do here — its own capability estimate. */
  confidence: number;
  /** Blast radius if the fix is wrong. */
  affectedAgents: number;
}

export interface HealingPolicy {
  /** Master switch. Off by default — see the module note. */
  autonomousHealingEnabled: boolean;
  /**
   * Risk at or above this is never applied automatically, however confident
   * the healer is. Default 40%.
   */
  maxAutonomousRiskPercent: number;
  /** Failure kinds the operator has excluded from autonomous healing. */
  excludedKinds?: FailureKind[];
}

export const DEFAULT_HEALING_POLICY: HealingPolicy = {
  autonomousHealingEnabled: false,
  maxAutonomousRiskPercent: 40,
};

/**
 * How well we understand each failure and its repair.
 *
 * `malformed_json` is near-zero risk: the failure is mechanically detectable,
 * the repair is a format instruction, and the sandbox can prove it by parsing.
 * `refusal_loop` is riskier because the repair loosens when the agent refuses —
 * getting it wrong makes an agent answer things it should have declined, which
 * is a worse failure than the one being fixed.
 */
const KIND_RISK: Record<FailureKind, { base: number; why: string }> = {
  malformed_json: {
    base: 0.05,
    why: "Format-only repair, and the sandbox proves it by parsing the output.",
  },
  empty_output: {
    base: 0.1,
    why: "Repair only requires a response to exist; easy to verify, hard to get wrong.",
  },
  schema_violation: {
    base: 0.2,
    why: "Schema conformance is checkable, but the repair can conflict with existing field rules.",
  },
  infinite_loop: {
    base: 0.35,
    why: "Repair changes retry behaviour, which can make the agent give up too early.",
  },
  ungrounded_repeat: {
    base: 0.4,
    why: "Tightens grounding. Over-tightening makes the agent refuse work it could do.",
  },
  refusal_loop: {
    base: 0.6,
    why: "Repair LOOSENS when the agent refuses. Getting this wrong means it answers things it should decline — worse than the original failure.",
  },
};

export function assessRisk(params: {
  incident: Incident;
  currentPrompt: string;
  candidate: string;
  /** How many agents run on this prompt. Blast radius. */
  affectedAgents: number;
  /** Times this prompt has already been healed. */
  priorHeals: number;
}): RiskAssessment {
  const { incident, currentPrompt, candidate, affectedAgents, priorHeals } = params;
  const factors: RiskFactor[] = [];

  const kind = KIND_RISK[incident.kind] ?? { base: 0.5, why: "Unfamiliar failure type." };
  factors.push({
    name: "Failure type",
    weight: 0.35,
    score: kind.base,
    reason: kind.why,
  });

  // How much of the prompt the change touches. A repair that doubles the prompt
  // is likelier to collide with an instruction already in it.
  const growth = (candidate.length - currentPrompt.length) / Math.max(currentPrompt.length, 1);
  const growthScore = Math.min(1, growth * 2);
  factors.push({
    name: "Prompt change size",
    weight: 0.15,
    score: growthScore,
    reason:
      growth < 0.2
        ? `Adds ${(growth * 100).toFixed(0)}% to the prompt — a contained change.`
        : `Adds ${(growth * 100).toFixed(0)}% to the prompt, which raises the chance of contradicting an existing instruction.`,
  });

  // Blast radius. One agent is a contained experiment; twenty is a deployment.
  const radiusScore = Math.min(1, affectedAgents / 20);
  factors.push({
    name: "Blast radius",
    weight: 0.25,
    score: radiusScore,
    reason:
      affectedAgents <= 1
        ? "Affects a single agent."
        : `Affects ${affectedAgents} agents — a bad fix reaches all of them at once.`,
  });

  // Repeated healing of the same prompt means earlier fixes did not hold. That
  // is evidence the healer does not understand this failure, and the right
  // response is to stop trying rather than to keep layering repairs.
  const repeatScore = Math.min(1, priorHeals * 0.35);
  factors.push({
    name: "Prior healing attempts",
    weight: 0.25,
    score: repeatScore,
    reason:
      priorHeals === 0
        ? "First attempt on this prompt."
        : `This prompt has been healed ${priorHeals} time(s) already — the earlier repairs did not hold, so the diagnosis is probably wrong.`,
  });

  const riskPercent = Math.round(
    factors.reduce((sum, f) => sum + f.weight * f.score, 0) * 100
  );

  // Confidence is not 1 - risk. A healer can be confident about a risky change
  // (it knows exactly what it is doing and that it is dangerous), and unsure
  // about a safe one. Confidence tracks how verifiable the fix is.
  const verifiable = incident.samples.length > 0 && ["malformed_json", "empty_output", "schema_violation"].includes(incident.kind);
  const confidence = verifiable ? 0.9 : incident.samples.length > 0 ? 0.6 : 0.3;

  return {
    riskPercent,
    factors,
    confidence,
    affectedAgents,
    verdict: verdictFor(riskPercent, incident),
  };
}

function verdictFor(riskPercent: number, incident: Incident): string {
  if (riskPercent < 15) {
    return `Low risk. ${incident.kind} has a mechanical repair the sandbox can prove.`;
  }
  if (riskPercent < 40) {
    return `Moderate risk. The repair is understood and testable, but it changes behaviour beyond formatting.`;
  }
  if (riskPercent < 70) {
    return `High risk. This repair can make the agent behave differently in cases that were working. A person should look at the diff.`;
  }
  return `Very high risk. Applying this without review could break behaviour that is currently correct.`;
}

export type HealingDecision =
  | { action: "apply"; reason: string }
  | { action: "propose"; reason: string }
  | { action: "skip"; reason: string };

/**
 * The gate. Both locks must open before anything is applied automatically.
 *
 * Note the ordering: the switch is checked first, so a workspace that has not
 * opted in never even sees a risk calculation used as justification.
 */
export function decideHealing(params: {
  assessment: RiskAssessment;
  policy: HealingPolicy;
  incident: Incident;
}): HealingDecision {
  const { assessment, policy, incident } = params;

  if (!policy.autonomousHealingEnabled) {
    return {
      action: "propose",
      reason:
        "Autonomous healing is off for this workspace. The fix has been generated and tested — apply it from the dashboard when you're ready.",
    };
  }

  if (policy.excludedKinds?.includes(incident.kind)) {
    return {
      action: "propose",
      reason: `"${incident.kind}" is excluded from autonomous healing in your settings. The fix is prepared and waiting.`,
    };
  }

  if (assessment.riskPercent >= policy.maxAutonomousRiskPercent) {
    return {
      action: "propose",
      reason: `Risk assessed at ${assessment.riskPercent}%, at or above your ${policy.maxAutonomousRiskPercent}% ceiling. Prepared but not applied — ${assessment.verdict}`,
    };
  }

  return {
    action: "apply",
    reason: `Risk ${assessment.riskPercent}%, below your ${policy.maxAutonomousRiskPercent}% ceiling. ${assessment.verdict}`,
  };
}
