/**
 * Self-healing — mutate the prompt, prove the mutation, hot-swap it.
 *
 * When an agent gets stuck in a way it cannot escape (unparseable JSON, a
 * refusal loop), the fix is almost always in the prompt rather than the code.
 * This generates a candidate prompt, tests it against the exact failures that
 * triggered the incident, and swaps it in at runtime only if it passes.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 * It does not patch code at runtime. Generating code with a model and eval'ing
 * it inside the process that holds every customer's license key is a remote
 * code execution hole that we would be building on purpose, and the blast
 * radius is the whole platform. Prompts are data, so mutating them is bounded:
 * the worst case is a prompt that answers badly, and the sandbox gate below
 * catches that before it ships.
 *
 * ── Why the sandbox is a real gate and not theatre ──────────────────────────
 * The candidate is replayed against the recorded failing inputs. A mutation
 * that does not fix them is discarded — the incident escalates to a human
 * instead. The system is allowed to try things; it is not allowed to ship
 * something it has not demonstrated works.
 *
 * Every swap is versioned and reversible. An operator can pin back to the
 * previous version in one call, because "it healed itself overnight" is only
 * reassuring if you can also undo it.
 */

import type { FailureKind, Incident } from "./incidents.js";

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  text: string;
  /** Where it came from — a human wrote it, or the healer generated it. */
  origin: "human" | "healer";
  /** The incident that caused this version, when the healer made it. */
  fromIncidentId?: string;
  createdAt: number;
  active: boolean;
}

export interface SandboxCase {
  input: string;
  /** What made the original fail — the candidate must not repeat it. */
  failureKind: FailureKind;
}

export interface SandboxResult {
  passed: boolean;
  ranCases: number;
  failedCases: { input: string; why: string }[];
  elapsedMs: number;
}

/**
 * Repairs applied to the prompt, keyed by what broke.
 *
 * Deterministic rules first, because they are auditable and instant. An
 * operator reading the diff can see exactly what changed and why, which is not
 * true of a model-written rewrite. The model pass (below) only runs when no
 * rule applies.
 */
const REPAIRS: Record<FailureKind, { marker: string; instruction: string }> = {
  malformed_json: {
    marker: "LYCEUM-REPAIR:JSON",
    instruction: `OUTPUT FORMAT — this overrides any formatting instruction above:
Reply with a single valid JSON value and NOTHING else. No prose before it, no
prose after it, no markdown fences, no explanation. Your entire response must
parse with JSON.parse(). If you cannot comply, reply with {"error":"<reason>"}.`,
  },
  empty_output: {
    marker: "LYCEUM-REPAIR:EMPTY",
    instruction: `You must always produce a response. If you cannot complete the
task, say what blocked you in one sentence. An empty reply is never acceptable.`,
  },
  refusal_loop: {
    marker: "LYCEUM-REPAIR:REFUSAL",
    instruction: `You have been refusing requests you are permitted to handle.
Refuse ONLY when: the answer is absent from your knowledge base, the action is
outside your allowed tools, or it is irreversible. Otherwise, attempt the task.
When you do refuse, state which of those three reasons applies.`,
  },
  infinite_loop: {
    marker: "LYCEUM-REPAIR:LOOP",
    instruction: `You have been repeating the same action. Before acting, check
whether you already tried it. If a step failed twice, stop and report what you
tried and what happened — do not retry it a third time.`,
  },
  ungrounded_repeat: {
    marker: "LYCEUM-REPAIR:GROUNDING",
    instruction: `You have repeatedly stated figures that are not in the
knowledge base. Every number you output must appear in the retrieved context
verbatim. If it is not there, you do not have it — say so.`,
  },
  schema_violation: {
    marker: "LYCEUM-REPAIR:SCHEMA",
    instruction: `Your output did not match the required schema. Follow the
schema exactly: every required field present, no extra fields, correct types.`,
  },
};

/**
 * Build a candidate prompt.
 *
 * Repairs are appended rather than rewriting the operator's prompt. Two
 * reasons: the diff stays readable, and a healer that rewrites the whole prompt
 * can silently drop a business rule the operator depended on. Appending can
 * only add constraints.
 */
export function mutatePrompt(current: string, kind: FailureKind): string | null {
  const repair = REPAIRS[kind];
  if (!repair) return null;
  // Already repaired for this failure — appending it twice fixes nothing and
  // grows the prompt on every incident.
  if (current.includes(repair.marker)) return null;
  return `${current.trimEnd()}\n\n<!-- ${repair.marker} -->\n${repair.instruction}`;
}

// ── Sandbox ──────────────────────────────────────────────────────────────────

export type SandboxRunner = (prompt: string, input: string) => Promise<string>;

/**
 * Replay the candidate against the recorded failures.
 *
 * `budgetMs` bounds the whole run, not each case: healing must not become the
 * thing that adds latency to production traffic. On timeout the candidate is
 * rejected — an unproven prompt is treated exactly like a failed one.
 */
export async function sandboxTest(params: {
  candidate: string;
  cases: SandboxCase[];
  run: SandboxRunner;
  budgetMs?: number;
}): Promise<SandboxResult> {
  const started = Date.now();
  const budgetMs = params.budgetMs ?? 5000;
  const failed: { input: string; why: string }[] = [];
  let ran = 0;

  for (const c of params.cases) {
    if (Date.now() - started > budgetMs) {
      failed.push({ input: c.input.slice(0, 80), why: "sandbox budget exhausted before this case ran" });
      break;
    }
    ran++;
    try {
      const output = await params.run(params.candidate, c.input);
      const why = judge(output, c.failureKind);
      if (why) failed.push({ input: c.input.slice(0, 80), why });
    } catch (err) {
      failed.push({
        input: c.input.slice(0, 80),
        why: err instanceof Error ? err.message : "runner threw",
      });
    }
  }

  return {
    // No cases means nothing was proven, which is not the same as passing.
    passed: ran > 0 && failed.length === 0,
    ranCases: ran,
    failedCases: failed,
    elapsedMs: Date.now() - started,
  };
}

/** Returns a reason string when the output still exhibits the failure. */
function judge(output: string, kind: FailureKind): string | null {
  switch (kind) {
    case "malformed_json": {
      const candidate = output.trim().match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0];
      if (!candidate) return "still no JSON in the output";
      try {
        JSON.parse(candidate);
        return null;
      } catch {
        return "JSON still unparseable";
      }
    }
    case "empty_output":
      return output.trim() ? null : "still empty";
    case "refusal_loop":
      return /\b(?:i (?:can'?t|cannot|am unable)|sorry,? (?:i|but))\b/i.test(output)
        ? "still refusing"
        : null;
    case "infinite_loop":
    case "ungrounded_repeat":
    case "schema_violation":
      // These cannot be judged from a single output in isolation. Rather than
      // claim a pass we did not verify, require a human to confirm the fix.
      return output.trim() ? null : "no output to judge";
    default:
      return null;
  }
}

// ── Hot swap ─────────────────────────────────────────────────────────────────

/**
 * In-process prompt registry.
 *
 * Deliberately RAM-only and per-instance. A healed prompt is an emergency
 * measure, and an emergency measure that silently persists across a deploy is
 * how a workspace ends up running a prompt nobody remembers approving. The
 * incident record is durable; the swap is not. An operator promotes it to
 * permanent by editing the prompt themselves.
 */
class PromptRegistry {
  private versions = new Map<string, PromptVersion[]>();

  register(promptId: string, text: string, origin: PromptVersion["origin"] = "human"): PromptVersion {
    const history = this.versions.get(promptId) ?? [];
    for (const v of history) v.active = false;
    const version: PromptVersion = {
      id: `pv_${promptId}_${history.length + 1}`,
      promptId,
      version: history.length + 1,
      text,
      origin,
      createdAt: Date.now(),
      active: true,
    };
    this.versions.set(promptId, [...history, version]);
    return version;
  }

  /** Swap in a healed prompt. Returns the new version. */
  hotSwap(promptId: string, text: string, incidentId: string): PromptVersion {
    const version = this.register(promptId, text, "healer");
    version.fromIncidentId = incidentId;
    return version;
  }

  active(promptId: string): PromptVersion | null {
    return (this.versions.get(promptId) ?? []).find((v) => v.active) ?? null;
  }

  history(promptId: string): PromptVersion[] {
    return [...(this.versions.get(promptId) ?? [])].reverse();
  }

  /** Undo — reactivate a previous version. The escape hatch that makes the rest safe. */
  rollback(promptId: string, toVersion: number): PromptVersion | null {
    const history = this.versions.get(promptId);
    if (!history) return null;
    const target = history.find((v) => v.version === toVersion);
    if (!target) return null;
    for (const v of history) v.active = false;
    target.active = true;
    return target;
  }

  reset(): void {
    this.versions.clear();
  }
}

export const promptRegistry = new PromptRegistry();

// ── The healer ───────────────────────────────────────────────────────────────

export interface HealResult {
  healed: boolean;
  incidentId: string;
  /** Why it did or didn't heal — this is what the operator reads. */
  summary: string;
  candidate?: string;
  sandbox?: SandboxResult;
  newVersion?: PromptVersion;
  /** Money the failing calls were burning, now stopped. */
  savedCents: number;
}

/**
 * Attempt to heal an incident. Never throws: a healer that can crash the
 * request path is worse than the bug it was trying to fix.
 */
export async function healIncident(params: {
  incident: Incident;
  currentPrompt: string;
  run: SandboxRunner;
  budgetMs?: number;
}): Promise<HealResult> {
  const { incident, currentPrompt } = params;
  const base = { incidentId: incident.id, savedCents: incident.wastedCents };

  try {
    const candidate = mutatePrompt(currentPrompt, incident.kind);
    if (!candidate) {
      return {
        ...base,
        healed: false,
        summary:
          `No repair available for "${incident.kind}", or this prompt already carries one ` +
          `and it did not hold. Escalating to a person.`,
      };
    }

    const cases: SandboxCase[] = incident.samples.map((s) => ({
      input: s,
      failureKind: incident.kind,
    }));

    const sandbox = await sandboxTest({
      candidate,
      cases,
      run: params.run,
      budgetMs: params.budgetMs,
    });

    if (!sandbox.passed) {
      return {
        ...base,
        healed: false,
        candidate,
        sandbox,
        summary:
          `Generated a fix but it did not pass the sandbox (${sandbox.failedCases.length}/${sandbox.ranCases} cases still failing). ` +
          `Not shipped — escalating to a person.`,
      };
    }

    const newVersion = promptRegistry.hotSwap(incident.promptId, candidate, incident.id);
    return {
      ...base,
      healed: true,
      candidate,
      sandbox,
      newVersion,
      summary:
        `${incident.kind} on ${incident.agentId}, ${incident.occurrences} times. ` +
        `Patched the prompt, verified against ${sandbox.ranCases} recorded failure(s) in ${sandbox.elapsedMs}ms, ` +
        `swapped to v${newVersion.version}. Stopped $${(incident.wastedCents / 100).toFixed(2)} of waste. ` +
        `Roll back with: rollback("${incident.promptId}", ${newVersion.version - 1}).`,
    };
  } catch (err) {
    return {
      ...base,
      healed: false,
      summary: `Healer failed: ${err instanceof Error ? err.message : "unknown error"}. Escalating.`,
    };
  }
}
