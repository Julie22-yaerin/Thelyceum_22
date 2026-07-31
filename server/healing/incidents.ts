/**
 * Failure detection — deciding when an agent is broken, not just unlucky.
 *
 * This is the trigger for self-healing, so the bar is deliberately high. A
 * healer that fires on a single bad response would rewrite prompts constantly
 * and make the system less predictable than the failures it was fixing.
 *
 * Every detector here answers the same question: is this a *pattern* the agent
 * cannot escape on its own? One malformed JSON is a bad sample. Four in a row
 * from the same agent is a prompt that no longer produces parseable output.
 */

export type FailureKind =
  | "malformed_json"
  | "infinite_loop"
  | "empty_output"
  | "refusal_loop"
  | "ungrounded_repeat"
  | "schema_violation";

export interface FailureSignal {
  kind: FailureKind;
  agentId: string;
  /** The prompt in force when it broke — what the healer will mutate. */
  promptId: string;
  detail: string;
  /** Raw output, truncated. Redacted before it ever leaves the tenant. */
  sample: string;
  at: number;
}

export interface Incident {
  id: string;
  licenseKey: string;
  agentId: string;
  promptId: string;
  kind: FailureKind;
  occurrences: number;
  firstSeen: number;
  lastSeen: number;
  samples: string[];
  /** Estimated spend on the failing calls — what a fix actually saves. */
  wastedCents: number;
  status: "open" | "healing" | "healed" | "escalated";
}

/** Consecutive failures of the same kind before healing is attempted. */
export const HEAL_THRESHOLD = 4;

// ── Detectors ────────────────────────────────────────────────────────────────

export function detectMalformedJson(output: string, expectJson: boolean): FailureSignal | null {
  if (!expectJson) return null;
  const trimmed = output.trim();
  if (!trimmed) return null;

  // Accept a fenced or prefixed object — models wrap JSON in prose constantly,
  // and treating that as a failure would fire on output that parses fine after
  // one obvious extraction step.
  const candidate = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];
  if (!candidate) {
    return signal("malformed_json", "No JSON object or array found in the output at all.", output);
  }
  try {
    JSON.parse(candidate);
    return null;
  } catch (err) {
    return signal(
      "malformed_json",
      `JSON present but unparseable: ${err instanceof Error ? err.message : "parse error"}`,
      output
    );
  }
}

export function detectEmptyOutput(output: string): FailureSignal | null {
  return output.trim().length === 0
    ? signal("empty_output", "The model returned nothing.", output)
    : null;
}

/**
 * A refusal loop is an agent that has decided it cannot help and now says so to
 * everything. Distinct from a correct refusal: correct refusals are specific
 * ("I don't have that in the knowledge base"), and a loop is the same generic
 * refusal regardless of what it was asked.
 */
export function detectRefusalLoop(recentOutputs: string[]): FailureSignal | null {
  if (recentOutputs.length < 3) return null;
  // "I'm unable" is a contraction, not "I am unable" — the common phrasing
  // must not slip past the detector on an apostrophe.
  const refusalish = /\b(?:i(?:'m| am)? (?:can'?t|cannot|unable|not able|won'?t)|i can'?t|sorry,? (?:i|but))\b/i;
  const last3 = recentOutputs.slice(-3);
  if (!last3.every((o) => refusalish.test(o))) return null;

  // The grounded refusal is the behaviour we *want* — never treat it as a bug.
  if (last3.every((o) => /don'?t have that in the knowledge base/i.test(o))) return null;

  return signal("refusal_loop", "Three consecutive generic refusals.", last3.join(" | "));
}

/**
 * Near-identical repeated payloads. The circuit breaker already stops these on
 * cost grounds; this classifies them so the healer knows *why* to mutate rather
 * than just that spending stopped.
 */
export function detectLoop(recentPayloads: string[], threshold = 3): FailureSignal | null {
  if (recentPayloads.length < threshold) return null;
  const window = recentPayloads.slice(-threshold);
  const normalised = window.map((p) => p.replace(/\s+/g, " ").trim().toLowerCase());
  const allSame = normalised.every((p) => p === normalised[0]);
  return allSame
    ? signal("infinite_loop", `Sent the same payload ${threshold} times running.`, window[0])
    : null;
}

function signal(kind: FailureKind, detail: string, sample: string): FailureSignal {
  return {
    kind,
    agentId: "",
    promptId: "",
    detail,
    sample: sample.slice(0, 2000),
    at: Date.now(),
  };
}

/** Roll individual signals into an incident once the threshold is crossed. */
export function foldIntoIncident(
  existing: Incident | null,
  sig: FailureSignal,
  params: { licenseKey: string; agentId: string; promptId: string; callCostCents: number }
): Incident {
  if (existing && existing.kind === sig.kind && existing.status === "open") {
    return {
      ...existing,
      occurrences: existing.occurrences + 1,
      lastSeen: sig.at,
      samples: [...existing.samples, sig.sample].slice(-5),
      wastedCents: existing.wastedCents + params.callCostCents,
    };
  }
  return {
    id: `inc_${sig.at.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    licenseKey: params.licenseKey,
    agentId: params.agentId,
    promptId: params.promptId,
    kind: sig.kind,
    occurrences: 1,
    firstSeen: sig.at,
    lastSeen: sig.at,
    samples: [sig.sample],
    wastedCents: params.callCostCents,
    status: "open",
  };
}

export function shouldHeal(incident: Incident): boolean {
  return incident.status === "open" && incident.occurrences >= HEAL_THRESHOLD;
}
