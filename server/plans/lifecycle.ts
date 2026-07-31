/**
 * Mission plans — an agent may not act on a goal until a human approves how.
 *
 * The loop, and why each step exists:
 *
 *   goal given
 *      ↓
 *   CLARIFYING   the agent asks what it genuinely cannot infer. A plan built
 *                on guessed constraints is a plan that gets rejected twice.
 *      ↓
 *   PLANNED      concrete steps, each with its risk, cost estimate and the
 *                tools it needs. Nothing has run yet.
 *      ↓
 *   ┌──────────┐
 *   │ APPROVED │ ← human says go
 *   │ REVISING │ ← human says change X, agent rewrites, back to PLANNED
 *   └──────────┘   this cycles until approved or abandoned
 *      ↓
 *   EXECUTING    steps run. Anything unexpected is measured: low risk the AI
 *                officer decides (if that permission is on), high risk stops
 *                and asks.
 *      ↓
 *   DONE / HALTED
 *
 * The property that matters: there is no path from "goal" to "acting" that
 * skips a human. Not when the agent is confident, not when the goal seems
 * obvious, not when a previous similar plan was approved. Approval is per-plan.
 */

import { getDb } from "../db/firestore.js";

export type PlanStatus =
  | "clarifying"
  | "planned"
  | "revising"
  | "approved"
  | "executing"
  | "done"
  | "halted"
  | "abandoned";

export type StepRisk = "low" | "medium" | "high";

export interface ClarifyingQuestion {
  id: string;
  question: string;
  /** Why the agent cannot proceed without this — stops lazy questions. */
  whyItMatters: string;
  answer?: string;
  answeredAt?: number;
}

export interface PlanStep {
  id: string;
  order: number;
  title: string;
  /** What it will actually do, concretely enough to object to. */
  detail: string;
  /** Tools it needs. Checked against the agent's scope before approval. */
  tools: string[];
  risk: StepRisk;
  /** Estimated cost in cents. Rough, and labelled as such in the UI. */
  estimatedCents: number;
  /** Set when the step is irreversible — sending, publishing, paying. */
  irreversible: boolean;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  result?: string;
}

export interface RevisionRequest {
  at: number;
  by: string;
  note: string;
}

export interface Plan {
  id: string;
  licenseKey: string;
  agentId: string;
  agentName: string;
  department: string;
  goal: string;
  status: PlanStatus;
  questions: ClarifyingQuestion[];
  steps: PlanStep[];
  /** Every rejection, so a repeatedly-revised plan is visible as a problem. */
  revisions: RevisionRequest[];
  approvedBy?: string;
  approvedAt?: number;
  /** Version bumps on each revision — approval is bound to a version. */
  version: number;
  createdAt: number;
  updatedAt: number;
}

const collection = () => getDb().collection("plans");

// ── Creation ─────────────────────────────────────────────────────────────────

export async function createPlan(params: {
  licenseKey: string;
  agentId: string;
  agentName: string;
  department: string;
  goal: string;
  questions: { question: string; whyItMatters: string }[];
}): Promise<Plan> {
  const ref = collection().doc();
  const now = Date.now();
  const plan: Plan = {
    id: ref.id,
    licenseKey: params.licenseKey,
    agentId: params.agentId,
    agentName: params.agentName,
    department: params.department,
    goal: params.goal,
    // A plan with no questions still starts here rather than at "planned":
    // the agent must explicitly say it has nothing to ask, which is a
    // different claim from never having considered it.
    status: "clarifying",
    questions: params.questions.map((q, i) => ({
      id: `q${i + 1}`,
      question: q.question,
      whyItMatters: q.whyItMatters,
    })),
    steps: [],
    revisions: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(plan);
  return plan;
}

export async function getPlan(licenseKey: string, planId: string): Promise<Plan | null> {
  const snap = await collection().doc(planId).get();
  if (!snap.exists) return null;
  const plan = snap.data() as Plan;
  // Scoped read: a plan id from another workspace resolves to nothing.
  return plan.licenseKey === licenseKey ? plan : null;
}

export async function listPlans(licenseKey: string): Promise<Plan[]> {
  const snap = await collection().where("licenseKey", "==", licenseKey).get();
  return (snap.docs ?? [])
    .map((d) => d.data() as Plan)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function save(plan: Plan): Promise<Plan> {
  const updated = { ...plan, updatedAt: Date.now() };
  await collection().doc(plan.id).set(updated, { merge: true });
  return updated;
}

// ── Clarification ────────────────────────────────────────────────────────────

export async function answerQuestions(params: {
  licenseKey: string;
  planId: string;
  answers: { id: string; answer: string }[];
}): Promise<Plan | null> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return null;

  const byId = new Map(params.answers.map((a) => [a.id, a.answer]));
  const questions = plan.questions.map((q) =>
    byId.has(q.id) ? { ...q, answer: byId.get(q.id), answeredAt: Date.now() } : q
  );

  return save({ ...plan, questions });
}

/** True when every question has an answer — the agent may now plan. */
export function readyToPlan(plan: Plan): boolean {
  return plan.questions.every((q) => typeof q.answer === "string" && q.answer.trim().length > 0);
}

// ── Planning ─────────────────────────────────────────────────────────────────

export async function submitPlan(params: {
  licenseKey: string;
  planId: string;
  steps: Omit<PlanStep, "id" | "order" | "status">[];
}): Promise<{ plan: Plan | null; error?: string }> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return { plan: null, error: "No such plan." };

  if (plan.status === "clarifying" && !readyToPlan(plan)) {
    return {
      plan: null,
      error: "Unanswered clarifying questions. The agent must not plan around a guess.",
    };
  }
  if (plan.status === "approved" || plan.status === "executing") {
    return { plan: null, error: "This plan is already approved — submit a new one instead." };
  }
  if (params.steps.length === 0) {
    return { plan: null, error: "A plan with no steps cannot be approved." };
  }

  const steps: PlanStep[] = params.steps.map((s, i) => ({
    ...s,
    id: `s${i + 1}`,
    order: i + 1,
    status: "pending",
  }));

  return {
    plan: await save({
      ...plan,
      steps,
      status: "planned",
      // A revised plan is a new version. Approval granted to v1 does not carry
      // to v2 — otherwise "approve, then quietly rewrite" is an open door.
      version: plan.status === "revising" ? plan.version + 1 : plan.version,
    }),
  };
}

// ── Approval ─────────────────────────────────────────────────────────────────

export async function approvePlan(params: {
  licenseKey: string;
  planId: string;
  by: string;
  /** Version the human is approving. Rejected if the plan has moved on. */
  version: number;
}): Promise<{ plan: Plan | null; error?: string }> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return { plan: null, error: "No such plan." };
  if (plan.status !== "planned") {
    return { plan: null, error: `Cannot approve a plan that is "${plan.status}".` };
  }
  if (plan.version !== params.version) {
    // The plan changed between being read and being approved. Approving what
    // is on screen is the only approval that means anything.
    return {
      plan: null,
      error: `This plan has been revised since you read it (you approved v${params.version}, it is now v${plan.version}). Re-read it before approving.`,
    };
  }

  return {
    plan: await save({
      ...plan,
      status: "approved",
      approvedBy: params.by,
      approvedAt: Date.now(),
    }),
  };
}

export async function requestRevision(params: {
  licenseKey: string;
  planId: string;
  by: string;
  note: string;
}): Promise<{ plan: Plan | null; error?: string }> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return { plan: null, error: "No such plan." };
  if (!["planned", "approved"].includes(plan.status)) {
    return { plan: null, error: `Cannot revise a plan that is "${plan.status}".` };
  }
  if (!params.note.trim()) {
    return { plan: null, error: "Say what needs to change — a rejection with no reason cannot be acted on." };
  }

  return {
    plan: await save({
      ...plan,
      status: "revising",
      // Approval is revoked by asking for changes. An approved-then-revised
      // plan that stayed approved would be the exact loophole this prevents.
      approvedBy: undefined,
      approvedAt: undefined,
      revisions: [...plan.revisions, { at: Date.now(), by: params.by, note: params.note.trim() }],
    }),
  };
}

// ── Execution ────────────────────────────────────────────────────────────────

export async function beginExecution(params: {
  licenseKey: string;
  planId: string;
}): Promise<{ plan: Plan | null; error?: string }> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return { plan: null, error: "No such plan." };
  if (plan.status !== "approved") {
    return {
      plan: null,
      error: `Refusing to execute: this plan is "${plan.status}", not approved. There is no path from a goal to an action that skips approval.`,
    };
  }
  return { plan: await save({ ...plan, status: "executing" }) };
}

export async function updateStep(params: {
  licenseKey: string;
  planId: string;
  stepId: string;
  status: PlanStep["status"];
  result?: string;
}): Promise<Plan | null> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return null;

  const steps = plan.steps.map((s) =>
    s.id === params.stepId ? { ...s, status: params.status, result: params.result ?? s.result } : s
  );
  const allSettled = steps.every((s) => ["done", "skipped", "failed"].includes(s.status));
  const anyFailed = steps.some((s) => s.status === "failed");

  return save({
    ...plan,
    steps,
    status: allSettled ? (anyFailed ? "halted" : "done") : plan.status,
  });
}

export async function haltPlan(params: {
  licenseKey: string;
  planId: string;
  reason: string;
}): Promise<Plan | null> {
  const plan = await getPlan(params.licenseKey, params.planId);
  if (!plan) return null;
  const steps = plan.steps.map((s) =>
    s.status === "pending" || s.status === "running" ? { ...s, status: "skipped" as const, result: params.reason } : s
  );
  return save({ ...plan, steps, status: "halted" });
}

// ── Summary for the UI ───────────────────────────────────────────────────────

export function planSummary(plan: Plan): {
  totalCents: number;
  highRiskSteps: number;
  irreversibleSteps: number;
  progress: number;
  needsHuman: boolean;
} {
  const done = plan.steps.filter((s) => ["done", "skipped"].includes(s.status)).length;
  return {
    totalCents: plan.steps.reduce((sum, s) => sum + s.estimatedCents, 0),
    highRiskSteps: plan.steps.filter((s) => s.risk === "high").length,
    irreversibleSteps: plan.steps.filter((s) => s.irreversible).length,
    progress: plan.steps.length === 0 ? 0 : Math.round((done / plan.steps.length) * 100),
    needsHuman: ["clarifying", "planned", "revising"].includes(plan.status),
  };
}
