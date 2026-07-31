/**
 * Pillar 1 — Conflict resolution.
 *
 * When two agents disagree — one approves the refund, another flags fraud —
 * something has to decide, and it must decide the same way every time. A
 * conflict resolved by whichever agent replied first is not a decision, it is
 * a race.
 *
 * The hierarchy is fixed and not configurable:
 *
 *     Safety & security  >  Financial limits  >  Compliance  >  Speed
 *
 * Read it as: a position that protects against harm beats one that protects
 * money, which beats one that protects process, which beats one that protects
 * throughput. Making this tunable would let a customer configure "ship fast"
 * above "don't leak data", and there is no legitimate reason to.
 *
 * Deterministic first. The LLM arbiter (below) only runs when the deterministic
 * pass genuinely cannot separate two positions, and even then it cannot pick a
 * winner outside the candidates or overturn a safety hold. Per the operator's
 * requirement: the arbiter is dormant until the system raises a conflict.
 */

export type ConcernKind = "safety" | "security" | "financial" | "compliance" | "operational";

/** Higher wins. Gaps are wide so a future insertion doesn't require renumbering. */
const PRIORITY: Record<ConcernKind, number> = {
  safety: 500,
  security: 400,
  financial: 300,
  compliance: 200,
  operational: 100,
};

export interface AgentPosition {
  agentId: string;
  department: string;
  /** What the agent wants to happen. */
  decision: string;
  /** The kind of concern this position defends. Drives the hierarchy. */
  concern: ConcernKind;
  /** Whether the agent is blocking (a veto) or merely recommending. */
  blocking: boolean;
  rationale: string;
  /** Agent's own confidence, 0–1. Only breaks ties within the same concern. */
  confidence?: number;
}

export type ArbitrationMethod = "single-position" | "hierarchy" | "veto" | "confidence" | "model" | "escalated";

export interface Arbitration {
  /** The position that won, or null when it must go to a human. */
  winner: AgentPosition | null;
  decision: string;
  method: ArbitrationMethod;
  reasoning: string;
  /** True when no rule could separate the positions — a person must decide. */
  escalated: boolean;
  /** Every position considered, for the audit trail. */
  considered: AgentPosition[];
  decidedInMs: number;
}

// ── Deterministic arbitration ────────────────────────────────────────────────

export function arbitrate(positions: AgentPosition[]): Arbitration {
  const started = Date.now();

  if (positions.length === 0) {
    return {
      winner: null,
      decision: "No position to arbitrate.",
      method: "escalated",
      reasoning: "Arbitration was invoked with no agent positions.",
      escalated: true,
      considered: [],
      decidedInMs: Date.now() - started,
    };
  }

  if (positions.length === 1) {
    return {
      winner: positions[0],
      decision: positions[0].decision,
      method: "single-position",
      reasoning: "Only one agent expressed a position; nothing to resolve.",
      escalated: false,
      considered: positions,
      decidedInMs: Date.now() - started,
    };
  }

  // A blocking safety or security position is a veto and ends it. This is
  // checked before the general hierarchy because a veto beats a *higher*
  // non-blocking position too: an advisory safety note loses to a blocking
  // one, and a blocking safety hold is not outvoted by anything.
  const veto = positions
    .filter((p) => p.blocking && (p.concern === "safety" || p.concern === "security"))
    .sort((a, b) => PRIORITY[b.concern] - PRIORITY[a.concern] || a.agentId.localeCompare(b.agentId))[0];

  if (veto) {
    return {
      winner: veto,
      decision: veto.decision,
      method: "veto",
      reasoning: `${veto.agentId} raised a blocking ${veto.concern} objection. Safety and security holds are absolute — no other concern overrides them.`,
      escalated: false,
      considered: positions,
      decidedInMs: Date.now() - started,
    };
  }

  const ranked = [...positions].sort(
    (a, b) =>
      PRIORITY[b.concern] - PRIORITY[a.concern] ||
      Number(b.blocking) - Number(a.blocking) ||
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      a.agentId.localeCompare(b.agentId)
  );

  const top = ranked[0];
  const runnerUp = ranked[1];

  const sameConcern = PRIORITY[top.concern] === PRIORITY[runnerUp.concern];
  const sameBlocking = top.blocking === runnerUp.blocking;

  if (!sameConcern) {
    return {
      winner: top,
      decision: top.decision,
      method: "hierarchy",
      reasoning: `${top.concern} outranks ${runnerUp.concern}. ${top.agentId}'s position stands.`,
      escalated: false,
      considered: positions,
      decidedInMs: Date.now() - started,
    };
  }

  if (sameBlocking) {
    const gap = (top.confidence ?? 0) - (runnerUp.confidence ?? 0);
    // A confidence gap this small is noise — two models reporting 0.81 and 0.79
    // have not told you anything. Escalate rather than pretend it's a signal.
    if (gap >= 0.2) {
      return {
        winner: top,
        decision: top.decision,
        method: "confidence",
        reasoning: `Both positions defend ${top.concern}. ${top.agentId} is materially more confident (${top.confidence} vs ${runnerUp.confidence}).`,
        escalated: false,
        considered: positions,
        decidedInMs: Date.now() - started,
      };
    }

    return {
      winner: null,
      decision: "Escalated to a human.",
      method: "escalated",
      reasoning: `${top.agentId} and ${runnerUp.agentId} both defend ${top.concern} with no meaningful confidence gap. A rule that picked one here would be arbitrary, so a person decides.`,
      escalated: true,
      considered: positions,
      decidedInMs: Date.now() - started,
    };
  }

  return {
    winner: top,
    decision: top.decision,
    method: "hierarchy",
    reasoning: `Both defend ${top.concern}; ${top.agentId} is blocking and ${runnerUp.agentId} is advisory. A block outranks a recommendation.`,
    escalated: false,
    considered: positions,
    decidedInMs: Date.now() - started,
  };
}

// ── Model arbiter (dormant until escalation) ─────────────────────────────────

const ARBITER_MODEL = process.env.LYCEUM_ARBITER_MODEL || "anthropic/claude-sonnet-4.5";

/**
 * Ask a model to break a tie the rules could not.
 *
 * Runs ONLY on an escalated arbitration — by the operator's requirement this
 * stays dormant until the system itself raises a conflict, so ordinary traffic
 * never pays for it and never depends on it.
 *
 * It is bounded hard: it may only choose among the agent ids already present,
 * and it cannot overturn a veto (a veto never reaches here). Anything else it
 * returns is discarded and the escalation stands. The model is a tie-breaker,
 * not an authority.
 */
export async function arbitrateWithModel(
  positions: AgentPosition[],
  deterministic: Arbitration
): Promise<Arbitration> {
  if (!deterministic.escalated) return deterministic;

  const key = process.env.LYCEUM_ARBITER_KEY;
  if (!key || positions.length === 0) return deterministic;

  const started = Date.now();
  const summary = positions
    .map(
      (p) =>
        `- id: ${p.agentId} (${p.department}) | concern: ${p.concern} | blocking: ${p.blocking}\n  wants: ${p.decision}\n  because: ${p.rationale}`
    )
    .join("\n");

  const prompt = `Two or more agents disagree and the deterministic rules could not separate them.

Hierarchy (binding, do not reinterpret): safety > security > financial > compliance > operational.

Positions:
${summary}

Choose the position that best protects the company under that hierarchy.
You MUST pick one of the agent ids listed above. You may not invent a compromise.
If both are genuinely equivalent and picking either would be arbitrary, return "escalate".

Reply with ONLY JSON: {"winner":"<agentId|escalate>","reason":"<one or two sentences>"}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ARBITER_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 300,
      }),
    });
    if (!res.ok) return deterministic;

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const match = (data.choices?.[0]?.message?.content ?? "").match(/\{[\s\S]*\}/);
    if (!match) return deterministic;

    const parsed = JSON.parse(match[0]) as { winner?: string; reason?: string };
    if (!parsed.winner || parsed.winner === "escalate") return deterministic;

    const winner = positions.find((p) => p.agentId === parsed.winner);
    // Not one of the candidates: the model went off-menu, so its answer is void.
    if (!winner) return deterministic;

    return {
      winner,
      decision: winner.decision,
      method: "model",
      reasoning: `Rules could not separate these positions; the arbiter chose ${winner.agentId}. ${parsed.reason ?? ""}`.trim(),
      escalated: false,
      considered: positions,
      decidedInMs: Date.now() - started,
    };
  } catch {
    return deterministic; // arbiter unreachable — the escalation stands
  }
}
