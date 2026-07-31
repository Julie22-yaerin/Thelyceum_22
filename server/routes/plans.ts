/**
 * Plan and escalation routes — the path from a goal to an action.
 *
 * The invariant these enforce: nothing executes until a human approves that
 * specific plan version. The red alert and emergency brake live here too,
 * because they are the same question asked urgently.
 */

import type express from "express";
import type { AuthedRequest } from "../lib/auth.js";
import {
  createPlan, getPlan, listPlans, answerQuestions, submitPlan,
  approvePlan, requestRevision, beginExecution, haltPlan, planSummary,
} from "../plans/lifecycle.js";
import {
  scanForDanger, engageBrake, DEFAULT_ESCALATION, type EscalationPolicy,
} from "../plans/escalation.js";
import { listWorkers } from "../db/workers.js";
import { pendingBreaches } from "../db/evidenceGraph.js";
import { readSlot, writeSlot, clearSlot } from "../db/workspaceState.js";

type Authenticate = express.RequestHandler;

export function registerPlansRoutes(app: express.Express, authenticateLicenseKey: Authenticate): void {
  // ── Plans: no goal reaches an action without a human approving how ───────

  app.get("/api/v1/plans", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const plans = await listPlans(req.lyceumAccount!.licenseKey);
    res.json({ plans: plans.map((p) => ({ ...p, summary: planSummary(p) })) });
  });

  app.get("/api/v1/plans/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const plan = await getPlan(req.lyceumAccount!.licenseKey, req.params.id);
    if (!plan) return res.status(404).json({ error: "No such plan." });
    res.json({ plan, summary: planSummary(plan) });
  });

  app.post("/api/v1/plans", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { agentId, agentName, department, goal, questions } = req.body ?? {};
    if (!goal || !agentId) {
      return res.status(400).json({ error: "goal and agentId are required" });
    }
    const plan = await createPlan({
      licenseKey: req.lyceumAccount!.licenseKey,
      agentId: String(agentId),
      agentName: String(agentName ?? agentId),
      department: String(department ?? "dev_ops"),
      goal: String(goal),
      questions: Array.isArray(questions) ? questions : [],
    });
    res.status(201).json({ plan });
  });

  app.post("/api/v1/plans/:id/answers", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const plan = await answerQuestions({
      licenseKey: req.lyceumAccount!.licenseKey,
      planId: req.params.id,
      answers: req.body?.answers ?? [],
    });
    if (!plan) return res.status(404).json({ error: "No such plan." });
    res.json({ plan });
  });

  app.post("/api/v1/plans/:id/steps", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { plan, error } = await submitPlan({
      licenseKey: req.lyceumAccount!.licenseKey,
      planId: req.params.id,
      steps: req.body?.steps ?? [],
    });
    if (!plan) return res.status(400).json({ error });
    res.json({ plan });
  });

  app.post("/api/v1/plans/:id/approve", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { plan, error } = await approvePlan({
      licenseKey: req.lyceumAccount!.licenseKey,
      planId: req.params.id,
      by: req.lyceumAccount!.email ?? "operator",
      version: Number(req.body?.version),
    });
    if (!plan) return res.status(409).json({ error });
    res.json({ plan });
  });

  app.post("/api/v1/plans/:id/revise", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { plan, error } = await requestRevision({
      licenseKey: req.lyceumAccount!.licenseKey,
      planId: req.params.id,
      by: req.lyceumAccount!.email ?? "operator",
      note: String(req.body?.note ?? ""),
    });
    if (!plan) return res.status(400).json({ error });
    res.json({ plan });
  });

  app.post("/api/v1/plans/:id/execute", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { plan, error } = await beginExecution({
      licenseKey: req.lyceumAccount!.licenseKey,
      planId: req.params.id,
    });
    if (!plan) return res.status(409).json({ error });
    res.json({ plan });
  });

  // ── Red alert + emergency brake ──────────────────────────────────────────
  // In-memory per instance: an alert is a live interrupt, not a record. The
  // record is the audit trail entry written when it is raised.



  app.get("/api/v1/warroom/alert", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    res.json({
      alert: await readSlot(req.lyceumAccount!.licenseKey, "activeAlert", null),
    });
  });

  /** An agent (or the pipeline) reports what it is about to do. */
  app.post("/api/v1/warroom/intent", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const intent = String(req.body?.intent ?? "");
    const danger = scanForDanger(intent);

    if (danger) {
      const alert = {
        id: `alert_${Date.now().toString(36)}`,
        agentId: String(req.body?.agentId ?? "unknown"),
        agentName: String(req.body?.agentName ?? req.body?.agentId ?? "An agent"),
        planId: req.body?.planId,
        stepTitle: req.body?.stepTitle,
        danger,
        raisedAt: Date.now(),
      };
      await writeSlot(licenseKey, "activeAlert", alert);
      return res.status(423).json({ blocked: true, alert });
    }
    res.json({ blocked: false });
  });

  app.post("/api/v1/warroom/alert/:id/continue", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    await clearSlot(req.lyceumAccount!.licenseKey, "activeAlert");
    res.json({ cleared: true, by: req.lyceumAccount!.email ?? "operator" });
  });

  app.post("/api/v1/warroom/alert/:id/brake", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const policy = await readSlot<EscalationPolicy>(
      licenseKey,
      "escalationPolicy",
      DEFAULT_ESCALATION
    );
    const result = await engageBrake({
      licenseKey,
      reason: "Operator pulled the emergency brake from a red alert.",
      policy,
      stopAll: async () => {
        const plans = await listPlans(licenseKey);
        const running = plans.filter((p) => ["executing", "approved"].includes(p.status));
        for (const p of running) {
          await haltPlan({ licenseKey, planId: p.id, reason: "Emergency brake." });
        }
        const workers = await listWorkers(licenseKey);
        return { agents: workers.length, plans: running.length };
      },
    });
    await clearSlot(licenseKey, "activeAlert");
    res.json(result);
  });

  app.get("/api/v1/warroom/escalation", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const policy = await readSlot<EscalationPolicy>(
      req.lyceumAccount!.licenseKey,
      "escalationPolicy",
      DEFAULT_ESCALATION
    );
    res.json({ policy, default: DEFAULT_ESCALATION });
  });

  app.put("/api/v1/warroom/escalation", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { officerMayDecide, humanThresholdPercent } = req.body ?? {};
    const policy = await readSlot<EscalationPolicy>(
      licenseKey,
      "escalationPolicy",
      DEFAULT_ESCALATION
    );
    if (typeof officerMayDecide === "boolean") policy.officerMayDecide = officerMayDecide;
    if (typeof humanThresholdPercent === "number") {
      policy.humanThresholdPercent = Math.max(0, Math.min(70, humanThresholdPercent));
    }
    await writeSlot(licenseKey, "escalationPolicy", policy);
    res.json({ policy });
  });

  // ── War room feed ────────────────────────────────────────────────────────

  app.get("/api/v1/warroom/feed", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const breaches = await pendingBreaches(licenseKey, limit);
    const account = req.lyceumAccount!;

    const events = breaches.map((b: any, i: number) => ({
      id: b.id ?? `ev${i}`,
      at: b.createdAt ?? Date.now(),
      actor: b.actorId ?? "system",
      text: b.summary ?? b.code ?? "blocked",
      level: "block" as const,
    }));

    res.json({
      events,
      metrics: {
        savedCents: breaches.reduce((s: number, b: any) => s + (b.preventedCents ?? 0), 0),
        budgetRemainingCents: (account.creditsRemaining ?? 0) * 10,
        // Labelled as an estimate in the UI. 6 minutes per blocked action is a
        // stated assumption, not a measurement, and the panel says so.
        hoursReclaimed: Math.round((breaches.length * 6) / 60 * 10) / 10,
        blocked: breaches.length,
      },
    });
  });

}
