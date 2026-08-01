/**
 * Autonomy routes — red team, cross-workspace immunity, self-healing, and the
 * reporting that makes all three auditable.
 *
 * These share a property worth stating: every one of them can change what the
 * platform does without a human in the loop, so every one of them writes to the
 * audit trail and exposes its policy for reading.
 */

import type express from "express";
import type { AuthedRequest } from "../lib/auth.js";
import { runRedTeam, summarise as summariseRedTeam, corpusSummary } from "../redteam/engine.js";
import { immunityRegistry, type ThreatSignature } from "../hive/immunity.js";
import { promptRegistry } from "../healing/promptMutation.js";
import { pendingBreaches } from "../db/evidenceGraph.js";
import { buildRoiReport, type UsageEvent } from "../analytics/roi.js";
import { DEFAULT_HEALING_POLICY, type HealingPolicy } from "../healing/riskAssessment.js";
import { readSlot, writeSlot } from "../db/workspaceState.js";
import { analyzeRetroactive, type HistoricalCall } from "../analytics/retroactive.js";

type Authenticate = express.RequestHandler;

export function registerAutonomyRoutes(app: express.Express, authenticateLicenseKey: Authenticate): void {
  // ── Red Team (shadow) ────────────────────────────────────────────────────
  // Replays the adversarial corpus against this workspace's own policy. No
  // model calls, no production traffic, no data mutated — it exercises the
  // guards, which are pure functions over configuration.

  app.get("/api/v1/redteam/corpus", authenticateLicenseKey, async (_req: AuthedRequest, res: express.Response) => {
    res.json({ categories: corpusSummary() });
  });

  app.post("/api/v1/redteam/run", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const run = await runRedTeam({
      licenseKey,
      departments: req.body?.departments,
      categories: req.body?.categories,
    });

    // A finding is a live attack pattern this workspace is vulnerable to.
    // Contributing it is what makes every other workspace immune — but only
    // the de-identified skeleton is ever shared, and extraction refuses
    // outright if anything non-structural survives.
    const contributed: { signature: string; stage: string; reason?: string }[] = [];
    if (req.body?.contributeToHive !== false) {
      for (const finding of run.findings) {
        const attack = (await import("../redteam/attacks.js")).ATTACKS.find(
          (a) => a.id === finding.attackId
        );
        if (!attack) continue;
        const result = await immunityRegistry.report({
          licenseKey,
          payload: attack.payload,
          guard: attack.expect.guard,
          category: finding.category,
          severity: finding.severity,
        });
        contributed.push({
          signature: result.signature?.id ?? "(not shared)",
          stage: result.signature?.stage ?? "refused",
          reason: result.refusedReason ?? result.decision?.reason,
        });
      }
    }

    res.json({ run, summary: summariseRedTeam(run), contributed });
  });

  // ── Hive immunity ────────────────────────────────────────────────────────

  app.get("/api/v1/hive", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const active = await immunityRegistry.activeFor(licenseKey);
    res.json({
      // Every field here is structural. There is no endpoint that returns
      // another workspace's traffic, because no such data is ever stored.
      enforcedHere: active.length,
      signatures: (await immunityRegistry.all()).map((s: ThreatSignature) => ({
        id: s.id,
        category: s.category,
        severity: s.severity,
        skeleton: s.skeleton,
        observedBy: s.observedBy,
        stage: s.stage,
        falsePositiveRate: s.falsePositiveRate,
        enforcedHere: active.some((a: ThreatSignature) => a.id === s.id),
        rejectedReason: s.rejectedReason,
      })),
    });
  });

  /** Screen a payload against this workspace's active immunity. */
  app.post("/api/v1/hive/screen", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const payload = String(req.body?.payload ?? "");
    if (!payload) return res.status(400).json({ error: "payload is required" });
    const result = await immunityRegistry.screen(licenseKey, payload);
    res.json({
      blocked: result.blocked,
      matchedSignature: result.signature?.id,
      category: result.signature?.category,
    });
  });

  // ── Self-healing ─────────────────────────────────────────────────────────

  app.get("/api/v1/healing/prompts/:promptId", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    res.json({ history: await promptRegistry.history(req.params.promptId) });
  });

  app.post("/api/v1/healing/rollback", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { promptId, toVersion } = req.body ?? {};
    if (!promptId || typeof toVersion !== "number") {
      return res.status(400).json({ error: "promptId and toVersion are required" });
    }
    const version = await promptRegistry.rollback(String(promptId), toVersion);
    if (!version) return res.status(404).json({ error: "No such prompt version." });
    res.json({ rolledBackTo: version });
  });

  // ── Audit trail ──────────────────────────────────────────────────────────
  // Backed by the evidence graph, which already records every proxied call and
  // every breach. This exposes it as a flat, filterable log because that is
  // the shape an auditor asks for.

  app.get("/api/v1/audit", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const breaches = await pendingBreaches(licenseKey, limit);
    res.json({
      entries: breaches.map((b: any) => ({
        id: b.id,
        at: b.createdAt ?? b.at,
        actor: b.actorId ?? b.actor ?? "unknown",
        actorKind: b.actorKind ?? "ai",
        action: b.kind ?? "breach",
        outcome: "blocked",
        reason: b.summary ?? b.reason,
        code: b.code,
        sessionId: b.sessionId,
      })),
      note:
        "Every entry is a real recorded event. Nothing here is reconstructed after the fact — " +
        "the record is written at the moment the decision is made.",
    });
  });

  // ── ROI ──────────────────────────────────────────────────────────────────

  // ── Retroactive analysis ─────────────────────────────────────────────────
  // For a prospect who has not turned this on yet: paste an export of past
  // API calls and see what could have been caught, using their own data
  // rather than a demo. Stateless — nothing here is stored, because this
  // export is the prospect's data before they are even a customer.

  app.post("/api/v1/roi/retroactive", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const calls = req.body?.calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      return res.status(400).json({ error: "calls must be a non-empty array" });
    }
    if (calls.length > 5000) {
      return res.status(413).json({ error: "5,000 rows max per analysis — split larger exports." });
    }
    const parsed: HistoricalCall[] = calls.map((c: any) => ({
      at: Number(c.at) || Date.now(),
      costCents: typeof c.costCents === "number" ? c.costCents : undefined,
      model: typeof c.model === "string" ? c.model : undefined,
      promptPreview: typeof c.promptPreview === "string" ? c.promptPreview.slice(0, 500) : undefined,
      responsePreview: typeof c.responsePreview === "string" ? c.responsePreview.slice(0, 500) : undefined,
    }));
    res.json(analyzeRetroactive(parsed));
  });

  app.get("/api/v1/roi", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const periodEnd = Date.now();
    const periodStart = periodEnd - days * 86_400_000;

    // Derived from the evidence graph rather than a separate counter, so the
    // ROI number and the audit trail can never disagree.
    const breaches = await pendingBreaches(licenseKey, 500);
    const events: UsageEvent[] = breaches.map((b: any) => ({
      at: b.createdAt ?? Date.now(),
      kind:
        b.code === "LOOP_DETECTED"
          ? ("loop_stopped" as const)
          : b.code === "BUDGET_EXCEEDED"
            ? ("budget_breach" as const)
            : b.code === "SCOPE_VIOLATION"
              ? ("scope_violation" as const)
              : ("budget_breach" as const),
      preventedCents: b.preventedCents ?? 0,
    }));

    const subscriptionCents = Number(req.query.subscriptionCents) || 0;
    res.json(
      buildRoiReport({
        events,
        periodStart,
        periodEnd,
        subscriptionCents,
        attacksRepelled: Number(req.query.attacksRepelled) || 0,
      })
    );
  });

  // ── Healing policy ───────────────────────────────────────────────────────
  // Autonomous healing is OFF until an operator turns it on here.

  app.get("/api/v1/healing/policy", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const policy = await readSlot<HealingPolicy>(
      req.lyceumAccount!.licenseKey,
      "healingPolicy",
      DEFAULT_HEALING_POLICY
    );
    res.json({ policy, default: DEFAULT_HEALING_POLICY });
  });

  app.put("/api/v1/healing/policy", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { autonomousHealingEnabled, maxAutonomousRiskPercent, excludedKinds } = req.body ?? {};
    const policy = await readSlot<HealingPolicy>(
      licenseKey,
      "healingPolicy",
      DEFAULT_HEALING_POLICY
    );

    if (typeof autonomousHealingEnabled === "boolean") {
      policy.autonomousHealingEnabled = autonomousHealingEnabled;
    }
    if (typeof maxAutonomousRiskPercent === "number") {
      // Clamped: a workspace cannot set the ceiling to 100 and call it a policy.
      policy.maxAutonomousRiskPercent = Math.max(0, Math.min(70, maxAutonomousRiskPercent));
    }
    if (Array.isArray(excludedKinds)) policy.excludedKinds = excludedKinds;

    await writeSlot(licenseKey, "healingPolicy", policy);
    res.json({ policy });
  });

}
