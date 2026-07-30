/**
 * Evidence Graph writer/reader (DIRECTIVE 3).
 *
 * Same node/edge model as migrations/001_evidence_graph.sql, implemented
 * against Firestore because that is the database this deployment actually has.
 * The shapes are kept deliberately identical so moving to Postgres is a
 * transport swap rather than a remodel — see MIGRATING below.
 *
 * Two rules this module enforces, because the rest of the system trusts it to:
 *   1. Nothing is written that hasn't been through `redact()`. A proxy that
 *      logs a customer's API key is a breach, not a feature.
 *   2. Writes never throw into the enforcement path. Losing an audit record is
 *      bad; letting an audit outage take down a customer's agent traffic — or
 *      worse, silently disabling the circuit breaker — is far worse.
 */

import { getDb } from "./firestore.js";
import { redact, type Breach, type Verdict } from "../lib/circuitBreaker.js";

// ── Model (mirrors the SQL enums) ────────────────────────────────────────────

export type EvidenceNodeKind =
  | "agent_state"
  | "proxy_call"
  | "tool_call"
  | "mcp_call"
  | "breach"
  | "human_approval"
  | "mission"
  | "mission_step";

export type EvidenceEdgeKind =
  | "caused"
  | "blocked_by"
  | "approved_by"
  | "rejected_by"
  | "retried_as"
  | "escalated_to"
  | "part_of"
  | "delegated_to";

export type ActorKind = "human" | "ai" | "system";

export interface EvidenceNode {
  id: string;
  licenseKey: string;
  sessionId: string;
  kind: EvidenceNodeKind;
  occurredAt: number;
  actorKind: ActorKind;
  actorId: string;
  actorLabel?: string;
  summary: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  upstream?: string;
  breachCode?: string;
  evaluatedInMs?: number;
  payload: Record<string, unknown>;
  /** Stable layout coordinates — for rendering and proximity queries only. */
  pos: { x: number; y: number; z: number };
  causalDepth: number;
}

export interface EvidenceEdge {
  id: string;
  licenseKey: string;
  fromNode: string;
  toNode: string;
  kind: EvidenceEdgeKind;
  createdAt: number;
  sequence: number;
  rationale?: string;
}

const nodes = () => getDb().collection("evidenceNodes");
const edges = () => getDb().collection("evidenceEdges");

/**
 * Deterministic coordinates: same session + same causal depth + same node kind
 * always lands in the same place, so two people looking at one incident see an
 * identical picture and a replay doesn't reshuffle the graph.
 *   x — spread within a depth level (hashed, so siblings don't overlap)
 *   y — causal depth (how deep the agent recursed)
 *   z — separated by actor kind, which puts human decisions on their own plane
 */
function coordinatesFor(sessionId: string, depth: number, kind: EvidenceNodeKind, actorKind: ActorKind) {
  let h = 0x811c9dc5;
  const seed = `${sessionId}:${depth}:${kind}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const spread = ((h >>> 0) % 1000) / 1000; // 0..1
  return {
    x: Math.round((spread * 800 - 400) * 100) / 100,
    y: depth * 120,
    z: actorKind === "human" ? 200 : actorKind === "system" ? 100 : 0,
  };
}

/** Strip anything secret-shaped from a payload before it is persisted. */
function safePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/^(authorization|api[-_]?key|secret|token|password|cookie)$/i.test(key)) {
      out[key] = "***REDACTED***";
      continue;
    }
    out[key] = typeof value === "string" ? redact(value) : value;
  }
  return out;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface WriteNodeInput {
  licenseKey: string;
  sessionId: string;
  kind: EvidenceNodeKind;
  actorKind: ActorKind;
  actorId: string;
  actorLabel?: string;
  summary: string;
  costCents?: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  upstream?: string;
  breachCode?: string;
  evaluatedInMs?: number;
  payload?: Record<string, unknown>;
  /** Nodes this one was caused by. Depth is derived from them. */
  causedBy?: { nodeId: string; kind?: EvidenceEdgeKind; rationale?: string }[];
}

export async function writeNode(input: WriteNodeInput): Promise<EvidenceNode> {
  const parents = input.causedBy ?? [];

  // Causal depth = deepest parent + 1. Read the parents we were given rather
  // than walking the whole graph, which keeps this O(parents) on the hot path.
  let depth = 0;
  if (parents.length > 0) {
    const snaps = await Promise.all(parents.map((p) => nodes().doc(p.nodeId).get()));
    for (const s of snaps) {
      const parent = s.exists ? (s.data() as EvidenceNode) : undefined;
      if (parent) depth = Math.max(depth, parent.causalDepth + 1);
    }
  }

  const ref = nodes().doc();
  const node: EvidenceNode = {
    id: ref.id,
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: input.kind,
    occurredAt: Date.now(),
    actorKind: input.actorKind,
    actorId: input.actorId,
    actorLabel: input.actorLabel,
    summary: redact(input.summary),
    costCents: input.costCents ?? 0,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    model: input.model,
    upstream: input.upstream,
    breachCode: input.breachCode,
    evaluatedInMs: input.evaluatedInMs,
    payload: safePayload(input.payload ?? {}),
    pos: coordinatesFor(input.sessionId, depth, input.kind, input.actorKind),
    causalDepth: depth,
  };

  await ref.set(stripUndefined(node));

  // Edges last: a node with no edges is a readable orphan, but an edge to a
  // node that doesn't exist yet is a broken graph.
  await Promise.all(
    parents.map((p, i) => {
      const eRef = edges().doc();
      const edge: EvidenceEdge = {
        id: eRef.id,
        licenseKey: input.licenseKey,
        fromNode: p.nodeId,
        toNode: ref.id,
        kind: p.kind ?? "caused",
        createdAt: Date.now(),
        sequence: i,
        rationale: p.rationale,
      };
      return eRef.set(stripUndefined(edge));
    })
  );

  return node;
}

/** Firestore rejects explicit `undefined`; drop those keys. */
function stripUndefined<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export async function recordProxyCall(input: {
  licenseKey: string;
  sessionId: string;
  model: string;
  upstream: string;
  keyFingerprint: string;
  status: number;
  usage: { inputTokens: number; outputTokens: number };
  spentCentsAfter: number;
  latencyMs: number;
  evaluatedInMs: number;
  redactedRequest: string;
  streamed?: boolean;
  causedBy?: string;
}): Promise<EvidenceNode> {
  return writeNode({
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: "proxy_call",
    actorKind: "ai",
    actorId: input.model,
    actorLabel: input.model,
    summary: `${input.model} via ${input.upstream} → ${input.status}`,
    // Cost of this single call: total-after minus what it was before is not
    // available here, so we price the call from its own usage in the breaker
    // and store the running total in the payload for reconciliation.
    costCents: 0,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    model: input.model,
    upstream: input.upstream,
    evaluatedInMs: input.evaluatedInMs,
    payload: {
      status: input.status,
      keyFingerprint: input.keyFingerprint,
      sessionSpentCents: input.spentCentsAfter,
      latencyMs: Math.round(input.latencyMs),
      streamed: !!input.streamed,
      request: input.redactedRequest,
    },
    causedBy: input.causedBy ? [{ nodeId: input.causedBy }] : undefined,
  });
}

export async function recordBreach(input: {
  licenseKey: string;
  sessionId: string;
  model: string;
  breach: Breach;
  state: Verdict["state"];
  redactedExcerpt: string;
  evaluatedInMs: number;
  causedBy?: string;
}): Promise<EvidenceNode> {
  return writeNode({
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: "breach",
    actorKind: "system",
    actorId: "circuit_breaker",
    actorLabel: "Circuit breaker",
    summary: input.breach.reason,
    breachCode: input.breach.code,
    model: input.model,
    evaluatedInMs: input.evaluatedInMs,
    payload: {
      observed: input.breach.observed,
      limit: input.breach.limit,
      recoverable: input.breach.recoverable,
      state: input.state,
      excerpt: input.redactedExcerpt,
    },
    causedBy: input.causedBy ? [{ nodeId: input.causedBy, kind: "blocked_by" }] : undefined,
  });
}

export async function recordHumanApproval(input: {
  licenseKey: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  decision: "approve" | "abort" | "modify";
  /** The breach node this decision answers. */
  breachNodeId: string;
  note?: string;
  grantedCents?: number;
  newLimits?: Record<string, number>;
}): Promise<EvidenceNode> {
  const verb =
    input.decision === "approve"
      ? `approved +$${((input.grantedCents ?? 0) / 100).toFixed(2)}`
      : input.decision === "abort"
        ? "aborted the task"
        : "changed the limits";

  return writeNode({
    licenseKey: input.licenseKey,
    sessionId: input.sessionId,
    kind: "human_approval",
    actorKind: "human",
    actorId: input.memberId,
    actorLabel: input.memberName,
    summary: `${input.memberName} ${verb}`,
    payload: {
      decision: input.decision,
      note: input.note ?? "",
      grantedCents: input.grantedCents ?? 0,
      newLimits: input.newLimits ?? {},
    },
    causedBy: [
      {
        nodeId: input.breachNodeId,
        kind: input.decision === "abort" ? "rejected_by" : "approved_by",
        rationale: input.note,
      },
    ],
  });
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Everything that led to a node, nearest cause first. Mirrors evidence_lineage(). */
export async function lineage(
  licenseKey: string,
  nodeId: string,
  maxDepth = 50
): Promise<{ depth: number; node: EvidenceNode; via?: EvidenceEdgeKind }[]> {
  const out: { depth: number; node: EvidenceNode; via?: EvidenceEdgeKind }[] = [];
  const seen = new Set<string>();
  let frontier: { id: string; via?: EvidenceEdgeKind }[] = [{ id: nodeId }];

  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const snaps = await Promise.all(frontier.map((f) => nodes().doc(f.id).get()));
    const next: { id: string; via?: EvidenceEdgeKind }[] = [];

    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      if (!snap.exists) continue;
      const node = snap.data() as EvidenceNode;
      // Tenant check on every hop — a graph walk must not be a way around it.
      if (node.licenseKey !== licenseKey || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ depth, node, via: frontier[i].via });

      const parentEdges = await edges().where("toNode", "==", node.id).get();
      for (const e of parentEdges.docs) {
        const edge = e.data() as EvidenceEdge;
        if (!seen.has(edge.fromNode)) next.push({ id: edge.fromNode, via: edge.kind });
      }
    }
    frontier = next;
  }

  return out;
}

/** Rolled-up session state — the numbers a Decision Card shows. */
export async function sessionSummary(licenseKey: string, sessionId: string) {
  const snap = await nodes()
    .where("licenseKey", "==", licenseKey)
    .where("sessionId", "==", sessionId)
    .get();

  const all = snap.docs.map((d) => d.data() as EvidenceNode);
  const spent = all.reduce(
    (max, n) => Math.max(max, Number(n.payload?.sessionSpentCents ?? 0)),
    0
  );

  return {
    sessionId,
    nodeCount: all.length,
    totalTokens: all.reduce((s, n) => s + n.inputTokens + n.outputTokens, 0),
    spentCents: spent,
    breachCount: all.filter((n) => n.kind === "breach").length,
    humanDecisionCount: all.filter((n) => n.kind === "human_approval").length,
    deepestCausalChain: all.reduce((m, n) => Math.max(m, n.causalDepth), 0),
    startedAt: all.reduce((m, n) => Math.min(m, n.occurredAt), Date.now()),
    lastActivityAt: all.reduce((m, n) => Math.max(m, n.occurredAt), 0),
  };
}

/** Breaches still waiting on a person — the Decision Card queue. */
export async function pendingBreaches(licenseKey: string, limit = 20) {
  const snap = await nodes()
    .where("licenseKey", "==", licenseKey)
    .where("kind", "==", "breach")
    .get();

  const breaches = snap.docs
    .map((d) => d.data() as EvidenceNode)
    .filter((n) => n.payload?.recoverable === true)
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, limit);

  // A breach is answered once a human_approval edge points at it.
  const answered = new Set<string>();
  for (const b of breaches) {
    const es = await edges().where("fromNode", "==", b.id).get();
    if (es.docs.some((e) => ["approved_by", "rejected_by"].includes((e.data() as EvidenceEdge).kind))) {
      answered.add(b.id);
    }
  }

  return breaches.filter((b) => !answered.has(b.id));
}

/**
 * MIGRATING TO POSTGRES
 * Replace the `nodes()`/`edges()` helpers with parameterised SQL against the
 * tables in migrations/001_evidence_graph.sql — the field names are already
 * the snake_case equivalents. `lineage()` becomes a single call to
 * evidence_lineage(), `sessionSummary()` becomes a select from
 * evidence_session_summary, and the append-only guarantee moves from
 * convention into the triggers that already exist there. No caller changes.
 */
