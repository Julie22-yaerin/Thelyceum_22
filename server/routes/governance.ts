/**
 * Governance routes — proxy tokens and decision cards.
 *
 * The proxy token is the credential an agent's traffic carries; the decision
 * card is where a human resolves what the breaker stopped. They are the two
 * ends of the same control.
 */

import type express from "express";
import type { AuthedRequest } from "../lib/auth.js";
import {
  mintProxyToken, listProxyTokens, revokeProxyToken, updateProxyPolicy,
} from "../db/proxyTokens.js";
import {
  pendingBreaches, sessionSummary, lineage, recordHumanApproval,
} from "../db/evidenceGraph.js";
import { breaker } from "../lib/circuitBreaker.js";

type Authenticate = express.RequestHandler;

export function registerGovernanceRoutes(app: express.Express, authenticateLicenseKey: Authenticate): void {
  // ── Governance: proxy tokens ────────────────────────────────────────────

  app.get("/api/v1/proxy-tokens", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const tokens = await listProxyTokens(req.lyceumAccount!.licenseKey);
    res.json({
      // The token itself is only shown at mint time; listing returns a prefix
      // so a leaked screenshot of this page isn't a working credential.
      tokens: tokens.map((t) => ({
        preview: `${t.token.slice(0, 16)}…`,
        label: t.label,
        defaultUpstream: t.defaultUpstream,
        policy: t.policy,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        revoked: !!t.revokedAt,
      })),
    });
  });

  app.post("/api/v1/proxy-tokens", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { label, defaultUpstream, policy } = (req.body ?? {}) as {
      label?: string;
      defaultUpstream?: "openai" | "anthropic" | "openrouter" | "google";
      policy?: Record<string, number>;
    };
    const record = await mintProxyToken({
      licenseKey: req.lyceumAccount!.licenseKey,
      label,
      defaultUpstream,
      policy: policy as never,
    });
    res.json({
      token: record.token,
      baseUrl: `${req.protocol}://${req.get("host")}/t/${record.token}/v1`,
      // Said explicitly because there is no second chance to copy it.
      notice: "Copy this now — the full token is not shown again.",
    });
  });

  app.delete("/api/v1/proxy-tokens/:token", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const ok = await revokeProxyToken(req.lyceumAccount!.licenseKey, req.params.token);
    if (!ok) return res.status(404).json({ error: "Token not found" });
    res.json({ revoked: true });
  });

  app.patch("/api/v1/proxy-tokens/:token/policy", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const ok = await updateProxyPolicy(
      req.lyceumAccount!.licenseKey,
      req.params.token,
      (req.body ?? {}) as never
    );
    if (!ok) return res.status(404).json({ error: "Token not found" });
    res.json({ updated: true });
  });

  // ── Governance: Decision Cards (DIRECTIVE 3, block 2) ───────────────────
  // The human-in-the-loop queue. A breach the breaker marked `recoverable`
  // waits here until a person approves more budget, aborts, or changes the
  // limits — and their decision is itself written into the evidence graph.

  app.get("/api/v1/decisions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const breaches = await pendingBreaches(licenseKey, 20);

    const cards = await Promise.all(
      breaches.map(async (b) => {
        const summary = await sessionSummary(licenseKey, b.sessionId);
        const live = await breaker.snapshot(b.sessionId);
        return {
          breachNodeId: b.id,
          sessionId: b.sessionId,
          taskName: (b.payload?.excerpt as string | undefined)?.slice(0, 80) ?? b.sessionId,
          reason: b.summary,
          breachCode: b.breachCode,
          observed: b.payload?.observed,
          limit: b.payload?.limit,
          model: b.model,
          occurredAt: b.occurredAt,
          evaluatedInMs: b.evaluatedInMs,
          spend: {
            spentCents: live.spentCents,
            // The ceiling the breach was measured against.
            limitCents: typeof b.payload?.limit === "number" ? (b.payload.limit as number) : null,
          },
          session: summary,
        };
      })
    );

    res.json({ cards });
  });

  app.post("/api/v1/decisions/:breachNodeId", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { decision, sessionId, grantCents, newLimits, note, memberId, memberName } =
      (req.body ?? {}) as {
        decision?: "approve" | "abort" | "modify";
        sessionId?: string;
        grantCents?: number;
        newLimits?: Record<string, number>;
        note?: string;
        memberId?: string;
        memberName?: string;
      };

    if (!decision || !sessionId) {
      return res.status(400).json({ error: "decision and sessionId are required" });
    }

    if (decision === "approve") {
      // Default +$1, matching the Decision Card's primary button.
      await breaker.raiseBudget(sessionId, grantCents ?? 100);
    } else if (decision === "abort") {
      // Abort means the session's counters stay spent — resetting them would
      // let the same runaway agent immediately start again. What "abort" does
      // is leave the ceiling in place so every further call keeps failing.
    } else if (decision === "modify" && newLimits) {
      // Raising money is the only limit change the breaker holds per-session;
      // structural limits live on the proxy token's policy.
      if (typeof newLimits.grantCents === "number") {
        await breaker.raiseBudget(sessionId, newLimits.grantCents);
      }
    }

    const node = await recordHumanApproval({
      licenseKey,
      sessionId,
      memberId: memberId ?? "member-owner",
      memberName: memberName ?? "You",
      decision,
      breachNodeId: req.params.breachNodeId,
      note,
      grantedCents: decision === "approve" ? (grantCents ?? 100) : newLimits?.grantCents,
      newLimits,
    });

    res.json({ recorded: true, decisionNodeId: node.id, state: await breaker.snapshot(sessionId) });
  });

  app.get("/api/v1/evidence/:nodeId/lineage", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const trail = await lineage(req.lyceumAccount!.licenseKey, req.params.nodeId);
    res.json({
      lineage: trail.map(({ depth, node, via }) => ({
        depth,
        via,
        id: node.id,
        kind: node.kind,
        actor: { kind: node.actorKind, label: node.actorLabel ?? node.actorId },
        summary: node.summary,
        costCents: node.costCents,
        breachCode: node.breachCode,
        occurredAt: node.occurredAt,
        pos: node.pos,
      })),
    });
  });
}
