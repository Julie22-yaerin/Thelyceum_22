import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { DOMAINS, type Domain } from "../client/src/lib/modelConfig.js";
import { KEY_MAP, MODEL_ROUTES, proxyToOpenRouter, proxyStreamToOpenRouter, type ProxyRequestBody } from "./lib/openrouter.js";
import { authenticateLicenseKey, type AuthedRequest } from "./lib/auth.js";
import { provisionAccount, rotateLicenseKey } from "./db/accounts.js";
import { getTask, listTasks } from "./db/tasks.js";
import type { TaskSessionData } from "./db/sessionTypes.js";
import { InsufficientCreditsError, runTask } from "./lib/runTask.js";
import { handleMcpRequest } from "./mcp/http-server.js";
import { getSupabase } from "./lib/supabase.js";
import { createProxyRouter } from "./proxy/llmProxy.js";
import {
  resolveProxyToken,
  mintProxyToken,
  listProxyTokens,
  revokeProxyToken,
  updateProxyPolicy,
} from "./db/proxyTokens.js";
import { breaker } from "./lib/circuitBreaker.js";
import { pendingBreaches, sessionSummary, lineage, recordHumanApproval } from "./db/evidenceGraph.js";
import { createWorker, listWorkers, revokeWorker, rotateWorkerToken } from "./db/workers.js";
import { createMission as createServerMission, listMissions as listServerMissions, updateStep as updateServerStep, progressOf } from "./db/missions.js";
import { isEphemeralStore } from "./db/firestore.js";
import {
  seedBrain,
  listDocuments as listBrainDocuments,
  putDocument as putBrainDocument,
  deleteDocument as deleteBrainDocument,
  DEPARTMENTS,
  IngestBlockedError,
  type DepartmentId,
} from "./brain/knowledge.js";
import { routeContext, scopeFor, buildSystemPrompt } from "./brain/contextRouter.js";
import { fileDocument, classify } from "./brain/librarian.js";
import { scopeForDepartment, GLOBAL_NEVER_ALLOWED } from "./pillars/scopeGuard.js";
import { verifyOutput } from "./pillars/factGuard.js";
import { arbitrate, type AgentPosition } from "./pillars/arbitration.js";
import { DEFAULT_FAILOVER } from "./pillars/failover.js";
import { runRedTeam, summarise as summariseRedTeam, corpusSummary } from "./redteam/engine.js";
import { immunityRegistry } from "./hive/immunity.js";
import { promptRegistry, healIncident } from "./healing/promptMutation.js";
import { DEFAULT_HEALING_POLICY, type HealingPolicy } from "./healing/riskAssessment.js";
import { buildRoiReport, type UsageEvent } from "./analytics/roi.js";
import {
  createPlan, getPlan, listPlans, answerQuestions, submitPlan,
  approvePlan, requestRevision, beginExecution, haltPlan, planSummary,
} from "./plans/lifecycle.js";
import {
  scanForDanger, routeDeviation, engageBrake,
  DEFAULT_ESCALATION, type EscalationPolicy,
} from "./plans/escalation.js";
import { securityHeaders, rateLimit, screenChatRequest, issueAuthState, consumeAuthState, corsPolicy } from "./lib/security.js";
import { fingerprintCredential } from "./lib/auth.js";
import {
  OAUTH_PROVIDERS,
  providerFor,
  isProviderConfigured,
  buildAuthorizeUrl,
  exchangeCode,
  renderAuthPage,
  renderCallbackSuccessPage,
} from "./lib/integrations.js";

// ── Lemon Squeezy payment tracking ──────────────────────────────────────────
// In-memory order store, keyed by the `ref` we attach to each checkout link.
// NOTE: resets on server restart — fine for an MVP waiting-page flow, but
// swap for a real DB/table before relying on this past a single instance.

interface OrderRecord {
  status: "pending" | "paid";
  licenseKey?: string;
  product?: string;
  email?: string;
  name?: string;
  organization?: string;
  paidAt?: number;
}

const orders = new Map<string, OrderRecord>();

// Manually-tracked slots claimed before this counter existed (e.g. earlier
// manual pre-orders) — the live counter starts here and counts up with real
// paid orders, capped at BETA_SLOT_CAP.
const BETA_SLOT_BASELINE = Number(process.env.BETA_SLOT_BASELINE ?? 84);
const BETA_SLOT_CAP = Number(process.env.BETA_SLOT_CAP ?? 100);

function verifyLemonSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const configured = process.env.ADMIN_TOKEN || "";
  const provided = req.header("x-admin-token") || "";
  const expected = Buffer.from(configured, "utf8");
  const actual = Buffer.from(provided, "utf8");
  const valid =
    configured.length > 0 && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ── Express app (API routes only) ───────────────────────────────────────────
// Shared between the standalone Node server (startServer, below — used by
// `npm start` on Render/Railway/Fly/etc) and the Vercel serverless entry
// point at server/vercel-entry.ts. Static file serving and the SPA
// catch-all are NOT registered here — on Vercel those are handled by the
// platform (see vercel.json); the standalone server adds them itself.

export function createApiApp(): express.Express {
  const app = express();

  // Trust the first proxy hop (Vercel edge, Render, etc.) so req.ip and
  // req.secure reflect the real client and TLS state. Without this, rate
  // limiting keys every user as the proxy's IP — one shared bucket.
  app.set("trust proxy", 1);

  // ── CORS allowlist ────────────────────────────────────────────────────
  // Explicit per-origin. Defaulting to "*" with an Authorization header
  // would expose the API to any site a user happens to visit; defaulting
  // to "no header" breaks the API for legitimate cross-origin callers
  // (e.g. an embed on a partner site). Lock to a known list instead.
  //
  // ALLOWED_ORIGINS is a comma-separated env var set per-environment.
  // Dev defaults include the local Vite origin; production should set
  // the real domains explicitly.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) {
    if (process.env.NODE_ENV === "production") {
      // Fail closed: in production with no allowlist, refuse cross-origin
      // requests entirely. Same-origin traffic is unaffected.
      allowedOrigins.push("https://thelyceum.ai", "https://www.thelyceum.ai");
    } else {
      allowedOrigins.push(
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000"
      );
    }
  }
  app.use(corsPolicy(allowedOrigins));

  // ── Web security baseline ─────────────────────────────────────────────
  // Headers first (before any route can write a response) and no version
  // banner. Rate limits are applied per-route below so LLM-facing endpoints
  // (which burn real money per call) get the strictest windows.
  app.disable("x-powered-by");
  app.use(securityHeaders());

  // ── Zero-Touch Proxy (DIRECTIVE 1 + 2) ─────────────────────────────────
  // Mounted FIRST and before express.json(): the proxy must forward the
  // client's exact bytes upstream, so it reads its own raw body and nothing
  // may consume the stream ahead of it. Paths are deliberately outside
  // /api/* so a client's baseURL reads naturally:
  //     https://proxy.thelyceum.ai/t/<token>/v1
  app.use(
    createProxyRouter({
      resolveTenant: async (token) => {
        const record = await resolveProxyToken(token).catch(() => null);
        if (!record) return null;
        return {
          token: record.token,
          licenseKey: record.licenseKey,
          defaultUpstream: record.defaultUpstream,
          policy: record.policy,
        };
      },
    })
  );

  // ── POST /api/webhooks/lemonsqueezy — must read the RAW body for HMAC
  // verification, so this is registered before the global express.json()
  // middleware below. Rate-limited: a webhook storm is a signal, not traffic.
  app.post(
    "/api/webhooks/lemonsqueezy",
    rateLimit({ windowMs: 60_000, max: 60 }),
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req: express.Request, res: express.Response) => {
      const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "";
      const signature = req.header("X-Signature");
      const rawBody = req.body as Buffer;

      if (!verifyLemonSignature(rawBody, signature, secret)) {
        return res.status(401).json({ error: "invalid signature" });
      }

      let payload: any;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "invalid json" });
      }

      const eventName: string | undefined = payload?.meta?.event_name;
      const ref: string | undefined = payload?.meta?.custom_data?.ref;

      const customData = payload?.meta?.custom_data ?? {};
      const existing = ref ? orders.get(ref) : undefined;

      if (ref && eventName === "license_key_created") {
        const licenseKey: string | undefined = payload?.data?.attributes?.key;
        const product: string | undefined = payload?.data?.attributes?.product_name;
        const email: string | undefined = payload?.data?.attributes?.user_email ?? existing?.email;
        const name: string | undefined = customData?.name ?? existing?.name;
        const organization: string | undefined = customData?.organization ?? existing?.organization;

        orders.set(ref, {
          ...existing,
          status: "paid",
          licenseKey,
          product,
          email,
          name,
          organization,
          paidAt: Date.now(),
        });

        // Provision the API/MCP account so the license key works as a
        // credential immediately — best-effort: a Firestore hiccup here
        // shouldn't fail the webhook (Lemon Squeezy will retry otherwise).
        if (licenseKey) {
          try {
            await provisionAccount({ licenseKey, email, name, organization, product });
          } catch (err) {
            // NEVER log the raw license key — it goes to stdout, then
            // to whatever log aggregator the deployment ships to. A
            // single screenshot of the dashboard then compromises
            // the customer. Fingerprint it instead.
            const fp = fingerprintCredential(licenseKey);
            console.error(`[Lyceum] Failed to provision account fp=${fp}`, err);
          }
        }
      } else if (ref && eventName === "order_created") {
        orders.set(ref, {
          ...existing,
          status: existing?.status === "paid" ? "paid" : "pending",
          email: payload?.data?.attributes?.user_email ?? existing?.email,
          name: customData?.name ?? existing?.name,
          organization: customData?.organization ?? existing?.organization,
        });
      }

      res.json({ received: true });
    }
  );

  // ── GET /api/orders/:ref — polled by the waiting page ──────────────────
  app.get("/api/orders/:ref", (req: express.Request, res: express.Response) => {
    const order = orders.get(req.params.ref);
    res.json(order ?? { status: "pending" });
  });

  // ── GET /api/beta-slots — public live counter for the landing page ─────
  app.get("/api/beta-slots", (_req: express.Request, res: express.Response) => {
    const paidCount = Array.from(orders.values()).filter((o) => o.status === "paid").length;
    const claimed = Math.min(BETA_SLOT_BASELINE + paidCount, BETA_SLOT_CAP);
    res.json({ claimed, cap: BETA_SLOT_CAP });
  });

  // ── GET /api/admin/orders — customers, orgs, license keys (token-gated) ─
  app.get("/api/admin/orders", requireAdmin, (_req: express.Request, res: express.Response) => {
    const list = Array.from(orders.entries())
      .map(([ref, order]) => ({ ref, ...order }))
      .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
    res.json({ orders: list });
  });

  // ── Middleware ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: "1mb" }));

  // ── POST /api/chat — Server-side OpenRouter proxy (non-streaming) ────
  // Rate-limited per IP and screened for prompt injection before any bytes go
  // upstream — this endpoint costs real money per call.
  app.post(
    "/api/chat",
    rateLimit({ windowMs: 60_000, max: 30 }),
    async (req: express.Request, res: express.Response) => {
      try {
        const screened = screenChatRequest(req.body);
        if (!screened.ok) {
          return res.status(screened.status).json({ error: screened.reason });
        }
        const result = await proxyToOpenRouter(req.body as ProxyRequestBody);
        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal server error";
        res.status(502).json({ error: message });
      }
    }
  );

  // ── POST /api/chat/stream — Streaming OpenRouter proxy (SSE) ──────────
  app.post(
    "/api/chat/stream",
    rateLimit({ windowMs: 60_000, max: 60 }),
    async (req: express.Request, res: express.Response) => {
      const { domain, messages, temperature, maxTokens } = (req.body ?? {}) as {
        domain?: string;
        messages?: { role: string; content: string }[];
        temperature?: number;
        maxTokens?: number;
      };

      const screened = screenChatRequest(req.body);
      if (!screened.ok) {
        return res.status(screened.status).json({ error: screened.reason });
      }

      if (!domain || !messages) {
        return res.status(400).json({ error: "Both 'domain' and 'messages' are required" });
      }

    const apiKey = KEY_MAP[domain as keyof typeof KEY_MAP];
    if (!apiKey) {
      return res.status(502).json({ error: `No API key configured for domain "${domain}"` });
    }

    const route = MODEL_ROUTES[domain as keyof typeof MODEL_ROUTES];
    if (!route) {
      return res.status(400).json({ error: `Unknown domain "${domain}"` });
    }

    try {
      await proxyStreamToOpenRouter({
        domain: domain as any,
        messages,
        temperature,
        maxTokens,
        onHeaders: (headers) => {
          // Forward SSE headers
          res.writeHead(headers.status || 200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          });
        },
        onChunk: (chunk: string) => {
          res.write(chunk);
        },
        onDone: () => {
          res.write("data: [DONE]\n\n");
          res.end();
        },
        onError: (err: Error) => {
          // If headers already sent, write error as SSE
          if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.write("data: [DONE]\n\n");
            res.end();
          } else {
            res.status(502).json({ error: err.message });
          }
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      if (!res.headersSent) {
        res.status(502).json({ error: message });
      } else {
        res.end();
      }
    }
  });

  // ── Session API ──────────────────────────────────────────────────────
  // All session routes require a valid license key (or admin token).
  // The client sends `Authorization: Bearer <license key>`.

  app.post("/api/sessions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    try {
      const { name, tasks } = (req.body ?? {}) as { name?: string; tasks?: any[] };
      if (!name || !tasks) {
        return res.status(400).json({ error: "Both 'name' and 'tasks' are required" });
      }
      const { createSession } = await import("./db/sessions.js");
      const session = await createSession({
        licenseKey: req.lyceumAccount!.licenseKey,
        name,
        tasks,
      });
      res.status(201).json({ session });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to create session" });
    }
  });

  app.get("/api/sessions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    try {
      const { listSessions } = await import("./db/sessions.js");
      const sessions = await listSessions(req.lyceumAccount!.licenseKey);
      res.json({ sessions });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to list sessions" });
    }
  });

  app.get("/api/sessions/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    try {
      const { getSession } = await import("./db/sessions.js");
      const session = await getSession(req.params.id, req.lyceumAccount!.licenseKey);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json({ session });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to get session" });
    }
  });

  app.put("/api/sessions/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    try {
      const { updateSessionTasks, updateSessionMeta, getSession } = await import("./db/sessions.js");
      const body = req.body ?? {};
      const licenseKey = req.lyceumAccount!.licenseKey;

      const hasTasks = Array.isArray(body.tasks);
      const hasMeta = body.active !== undefined || body.activeTaskId !== undefined || body.name !== undefined;
      const hasAuditLog = body.autoAnswerAuditLog !== undefined;

      if (!hasTasks && !hasMeta && !hasAuditLog) {
        return res.status(400).json({ error: "No updatable fields provided" });
      }

      if (hasTasks) {
        const session = await updateSessionTasks(req.params.id, licenseKey, body.tasks);
        if (!session) return res.status(404).json({ error: "Session not found" });
      }

      if (hasMeta || hasAuditLog) {
        const metaToSave: Partial<Pick<TaskSessionData, "activeTaskId" | "active" | "name" | "autoAnswerAuditLog">> = {};
        if (body.active !== undefined) metaToSave.active = body.active;
        if (body.activeTaskId !== undefined) metaToSave.activeTaskId = body.activeTaskId;
        if (body.name !== undefined) metaToSave.name = body.name;
        if (hasAuditLog) metaToSave.autoAnswerAuditLog = (body as any).autoAnswerAuditLog;

        const session = await updateSessionMeta(req.params.id, licenseKey, metaToSave);
        if (!session) return res.status(404).json({ error: "Session not found" });
        return res.json({ session });
      }

      // Fetch the updated session to return (tasks were saved above, no meta changes)
      const finalSession = await getSession(req.params.id, licenseKey);
      res.json({ session: finalSession });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to update session" });
    }
  });

  app.delete("/api/sessions/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    try {
      const { deleteSession } = await import("./db/sessions.js");
      const deleted = await deleteSession(req.params.id, req.lyceumAccount!.licenseKey);
      if (!deleted) return res.status(404).json({ error: "Session not found" });
      res.json({ deleted: true });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "Failed to delete session" });
    }
  });

  // ── GET /api/health — Server health check ─────────────────────────────
  app.get("/api/health", (_req: express.Request, res: express.Response) => {
    res.json({
      status: "ok",
      domains: Object.keys(KEY_MAP),
      keysConfigured: Object.entries(KEY_MAP)
        .filter(([, v]) => !!v)
        .map(([k]) => k),
      mcpEndpoint: "/api/mcp",
      apiEndpoint: "/api/v1/chat",
      timestamp: Date.now(),
    });
  });

  // ── GET /api/notes — Supabase smoke test (see client/src/pages/Notes.tsx) ─
  app.get("/api/notes", async (_req: express.Request, res: express.Response) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from("notes").select();
      if (error) return res.status(502).json({ error: error.message });
      res.json({ notes: data });
    } catch (err) {
      res.status(503).json({ error: err instanceof Error ? err.message : "Supabase not configured" });
    }
  });

  // ── V1 public API + MCP — both channels share one credential: the Lemon
  // Squeezy license key, sent as `Authorization: Bearer <license key>`. ──

  /**
   * Dev-only: mint a workspace so the product can actually be run and demoed.
   *
   * Without this there is no way to get past the front door locally — you
   * cannot see the war room, the brain, or a single guard working. That made
   * the product undemoable to its own founder, which is a real defect even
   * though it is not a runtime bug.
   *
   * Guarded three ways, because a provisioning endpoint is exactly what an
   * attacker wants: refused unless NODE_ENV is explicitly "development", rate
   * limited, and it mints a random key rather than accepting one from the
   * caller (so it cannot be used to take over an existing workspace).
   */
  app.post(
    "/api/v1/dev/workspace",
    rateLimit({ windowMs: 60_000, max: 5 }),
    async (req: express.Request, res: express.Response) => {
      if (process.env.NODE_ENV !== "development") {
        return res.status(404).json({ error: "Not found" });
      }
      const licenseKey = `lyc_dev_${crypto.randomBytes(16).toString("base64url")}`;
      const account = await provisionAccount({
        licenseKey,
        email: String(req.body?.email ?? "founder@localhost"),
        name: String(req.body?.name ?? "Founder"),
        organization: String(req.body?.organization ?? "Demo Workspace"),
        product: String(req.body?.product ?? "VIP"),
      });
      await seedBrain(licenseKey);
      res.status(201).json({
        licenseKey,
        credits: account.creditsRemaining,
        note: "Development workspace. This endpoint returns 404 unless NODE_ENV=development.",
      });
    }
  );

  app.get("/api/v1/account", authenticateLicenseKey, (req: AuthedRequest, res: express.Response) => {
    const account = req.lyceumAccount!;
    res.json({
      // name/organization come from the checkout, which is why the app needs
      // no onboarding wizard to learn who the customer is.
      name: account.name ?? null,
      organization: account.organization ?? null,
      product: account.product,
      creditsRemaining: account.creditsRemaining,
      creditsTotal: account.creditsTotal,
    });
  });

  // ── POST /api/v1/license/rotate — issue a new key, keep the old one
  // valid for a grace window so in-flight clients don't get cut off.
  //
  // Rate-limited tightly: a rotation is a privileged action; if it ever
  // fires faster than 5/hour it's almost certainly a runaway script.
  // The new key is returned in the response body exactly once. The audit
  // trail records the fingerprint of both old and new keys, never the
  // raw values.
  app.post(
    "/api/v1/license/rotate",
    rateLimit({ windowMs: 60 * 60_000, max: 5 }),
    authenticateLicenseKey,
    async (req: AuthedRequest, res: express.Response) => {
      const oldKey = req.lyceumAccount!.licenseKey;
      const graceMs =
        Number(process.env.ROTATE_GRACE_HOURS ?? 24) * 60 * 60_000;
      const result = await rotateLicenseKey(oldKey, graceMs);
      if (!result) {
        return res.status(404).json({ error: "Account not found" });
      }
      const oldFp = fingerprintCredential(oldKey);
      const newFp = fingerprintCredential(result.newKey);
      console.log(
        `[security] license rotated: oldFp=${oldFp} newFp=${newFp} graceHours=${graceMs / 3_600_000}`
      );
      res.json({
        licenseKey: result.newKey,
        graceUntil: result.graceUntil,
        graceHours: graceMs / 3_600_000,
        message:
          "Save the new key now. The old key works for the grace window, then stops.",
      });
    }
  );

  app.post(
    "/api/v1/chat",
    // Per-license limiter: runTask burns the customer's real credits.
    rateLimit({ windowMs: 60_000, max: 120, key: (req) => `lk:${req.header("authorization") ?? req.ip}` }),
    authenticateLicenseKey,
    async (req: AuthedRequest, res: express.Response) => {
      const { domain, prompt } = (req.body ?? {}) as { domain?: string; prompt?: string };
    if (!domain || !prompt) {
      return res.status(400).json({ error: "Both 'domain' and 'prompt' are required" });
    }
    if (!(DOMAINS as readonly string[]).includes(domain)) {
      return res.status(400).json({ error: `domain must be one of: ${DOMAINS.join(", ")}` });
    }
    try {
      const result = await runTask({
        licenseKey: req.lyceumAccount!.licenseKey,
        domain: domain as Domain,
        prompt,
        source: "api",
      });
      res.json(result);
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return res.status(402).json({ error: err.message, remaining: err.remaining });
      }
      res.status(502).json({ error: err instanceof Error ? err.message : "Task failed" });
    }
  });

  app.get("/api/v1/tasks", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const limit = Number(req.query.limit) || 20;
    const tasks = await listTasks(req.lyceumAccount!.licenseKey, limit);
    res.json({ tasks });
  });

  app.get("/api/v1/tasks/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const task = await getTask(req.params.id, req.lyceumAccount!.licenseKey);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ task });
  });

  // ── MCP — Streamable HTTP, stateless (see server/mcp/http-server.ts) ───
  // A single pasteable URL is the whole integration story for an AI, so the
  // worker token may ride in the path. Lifting it into the Authorization
  // header here keeps one auth path rather than two.
  // MCP tools also run real tasks against credits, so they get the same
  // per-license limiter as /api/v1/chat.
  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    max: 240,
    key: (req) => `mcp:${req.header("authorization") ?? req.ip}`,
  });
  app.all(
    "/api/mcp/w/:token",
    (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.headers.authorization = `Bearer ${req.params.token}`;
      next();
    },
    mcpLimiter,
    authenticateLicenseKey,
    handleMcpRequest
  );
  app.all("/api/mcp", mcpLimiter, authenticateLicenseKey, handleMcpRequest);

  // ── Roster: AI workers and their MCP URLs ───────────────────────────────

  const mcpUrlFor = (req: express.Request, token: string) =>
    `${req.protocol}://${req.get("host")}/api/mcp/w/${token}`;

  // ── Second Brain ─────────────────────────────────────────────────────────
  // The knowledge every agent is grounded on. Scoped per workspace and per
  // department: what an agent can read is decided here, not by the agent.

  app.get("/api/v1/brain", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    let docs = await listBrainDocuments(licenseKey);

    // First visit to an empty workspace seeds the template, so the brain is
    // never an empty screen the operator has to populate before anything works.
    if (docs.length === 0) {
      await seedBrain(licenseKey);
      docs = await listBrainDocuments(licenseKey);
    }

    res.json({
      ephemeralStore: isEphemeralStore(),
      departments: DEPARTMENTS.map((d) => ({
        ...d,
        scope: scopeFor(d.id),
        tools: scopeForDepartment(d.id),
        documentCount: docs.filter((doc) => doc.path.startsWith(`departments/${d.id}/`)).length,
      })),
      globalNeverAllowed: GLOBAL_NEVER_ALLOWED,
      failover: DEFAULT_FAILOVER,
      documents: docs.map((d) => ({
        id: d.id,
        path: d.path,
        title: d.title,
        alwaysInclude: d.alwaysInclude,
        origin: d.origin,
        updatedAt: d.updatedAt,
        preview: d.body.slice(0, 240),
      })),
    });
  });

  app.post("/api/v1/brain/documents", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { title, body, department } = req.body ?? {};
    if (!title || !body) {
      return res.status(400).json({ error: "title and body are required" });
    }
    try {
      const result = await fileDocument({
        licenseKey,
        title: String(title),
        body: String(body),
        department: department as DepartmentId | undefined,
      });
      res.status(201).json(result);
    } catch (err) {
      // A refused document is not a server error — it is the guard doing its
      // job, and the operator needs the evidence to judge it themselves.
      if (err instanceof IngestBlockedError) {
        return res.status(422).json({
          error: err.message,
          findings: err.verdict.findings,
          hint: "This document contains instructions aimed at the assistant. If it is genuinely yours, remove those lines and try again.",
        });
      }
      throw err;
    }
  });

  /** Where would this land? Lets the operator see the filing before committing. */
  app.post("/api/v1/brain/classify", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { title, body } = req.body ?? {};
    if (!title && !body) return res.status(400).json({ error: "title or body is required" });
    res.json(await classify(String(title ?? ""), String(body ?? "")));
  });

  app.delete("/api/v1/brain/documents", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const path = String(req.query.path ?? "");
    if (!path) return res.status(400).json({ error: "path is required" });
    const ok = await deleteBrainDocument(licenseKey, path);
    res.json({ deleted: ok });
  });

  /**
   * Show exactly what an agent in this department would be given for a query —
   * scope, documents, and the literal system prompt. The setup screen uses it
   * so an operator can verify isolation themselves rather than trusting a
   * checkbox that says "isolated".
   */
  app.post("/api/v1/brain/preview", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { department, query, agentName, role } = req.body ?? {};
    if (!department || !query) {
      return res.status(400).json({ error: "department and query are required" });
    }
    const context = await routeContext({
      licenseKey,
      department: department as DepartmentId,
      query: String(query),
    });
    res.json({
      scope: context.scope,
      empty: context.empty,
      documents: context.documents.map((d) => ({ path: d.path, title: d.title })),
      systemPrompt: buildSystemPrompt({
        context,
        agentName: String(agentName || "Agent"),
        role: String(role || "assistant"),
      }),
    });
  });

  /** Check a draft against the brain without spending a model call. */
  app.post("/api/v1/pillars/factcheck", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const { department, query, output } = req.body ?? {};
    if (!department || !output) {
      return res.status(400).json({ error: "department and output are required" });
    }
    const context = await routeContext({
      licenseKey,
      department: department as DepartmentId,
      query: String(query ?? output),
    });
    res.json(verifyOutput({ output: String(output), context: context.groundingText }));
  });

  /** Resolve a disagreement between agents. Deterministic; no model call. */
  app.post("/api/v1/pillars/arbitrate", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const positions = req.body?.positions;
    if (!Array.isArray(positions)) {
      return res.status(400).json({ error: "positions[] is required" });
    }
    res.json(arbitrate(positions as AgentPosition[]));
  });

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
        const attack = (await import("./redteam/attacks.js")).ATTACKS.find(
          (a) => a.id === finding.attackId
        );
        if (!attack) continue;
        const result = immunityRegistry.report({
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
    const active = immunityRegistry.activeFor(licenseKey);
    res.json({
      // Every field here is structural. There is no endpoint that returns
      // another workspace's traffic, because no such data is ever stored.
      enforcedHere: active.length,
      signatures: immunityRegistry.all().map((s) => ({
        id: s.id,
        category: s.category,
        severity: s.severity,
        skeleton: s.skeleton,
        observedBy: s.observedBy,
        stage: s.stage,
        falsePositiveRate: s.falsePositiveRate,
        enforcedHere: active.some((a) => a.id === s.id),
        rejectedReason: s.rejectedReason,
      })),
    });
  });

  /** Screen a payload against this workspace's active immunity. */
  app.post("/api/v1/hive/screen", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const payload = String(req.body?.payload ?? "");
    if (!payload) return res.status(400).json({ error: "payload is required" });
    const result = immunityRegistry.screen(licenseKey, payload);
    res.json({
      blocked: result.blocked,
      matchedSignature: result.signature?.id,
      category: result.signature?.category,
    });
  });

  // ── Self-healing ─────────────────────────────────────────────────────────

  app.get("/api/v1/healing/prompts/:promptId", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    res.json({ history: promptRegistry.history(req.params.promptId) });
  });

  app.post("/api/v1/healing/rollback", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { promptId, toVersion } = req.body ?? {};
    if (!promptId || typeof toVersion !== "number") {
      return res.status(400).json({ error: "promptId and toVersion are required" });
    }
    const version = promptRegistry.rollback(String(promptId), toVersion);
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

  let healingPolicy: HealingPolicy = { ...DEFAULT_HEALING_POLICY };

  app.get("/api/v1/healing/policy", authenticateLicenseKey, async (_req: AuthedRequest, res: express.Response) => {
    res.json({ policy: healingPolicy, default: DEFAULT_HEALING_POLICY });
  });

  app.put("/api/v1/healing/policy", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { autonomousHealingEnabled, maxAutonomousRiskPercent, excludedKinds } = req.body ?? {};
    if (typeof autonomousHealingEnabled === "boolean") {
      healingPolicy.autonomousHealingEnabled = autonomousHealingEnabled;
    }
    if (typeof maxAutonomousRiskPercent === "number") {
      // Clamped: a workspace cannot set the ceiling to 100 and call it a policy.
      healingPolicy.maxAutonomousRiskPercent = Math.max(0, Math.min(70, maxAutonomousRiskPercent));
    }
    if (Array.isArray(excludedKinds)) healingPolicy.excludedKinds = excludedKinds;
    res.json({ policy: healingPolicy });
  });

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

  const activeAlerts = new Map<string, any>();
  let escalationPolicy: EscalationPolicy = { ...DEFAULT_ESCALATION };

  app.get("/api/v1/warroom/alert", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    res.json({ alert: activeAlerts.get(req.lyceumAccount!.licenseKey) ?? null });
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
      activeAlerts.set(licenseKey, alert);
      return res.status(423).json({ blocked: true, alert });
    }
    res.json({ blocked: false });
  });

  app.post("/api/v1/warroom/alert/:id/continue", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    activeAlerts.delete(req.lyceumAccount!.licenseKey);
    res.json({ cleared: true, by: req.lyceumAccount!.email ?? "operator" });
  });

  app.post("/api/v1/warroom/alert/:id/brake", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const result = await engageBrake({
      licenseKey,
      reason: "Operator pulled the emergency brake from a red alert.",
      policy: escalationPolicy,
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
    activeAlerts.delete(licenseKey);
    res.json(result);
  });

  app.get("/api/v1/warroom/escalation", authenticateLicenseKey, async (_req: AuthedRequest, res: express.Response) => {
    res.json({ policy: escalationPolicy, default: DEFAULT_ESCALATION });
  });

  app.put("/api/v1/warroom/escalation", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { officerMayDecide, humanThresholdPercent } = req.body ?? {};
    if (typeof officerMayDecide === "boolean") escalationPolicy.officerMayDecide = officerMayDecide;
    if (typeof humanThresholdPercent === "number") {
      escalationPolicy.humanThresholdPercent = Math.max(0, Math.min(70, humanThresholdPercent));
    }
    res.json({ policy: escalationPolicy });
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

  // ── Integrations (MCP connections to external tools) ─────────────────────
  // The connect flow is real end-to-end: the server issues a single-use
  // `state` bound to the license key, builds the authorize URL (the real
  // provider consent page when OAuth apps are registered, our own sandbox
  // consent page otherwise), and the callback exchanges the code
  // server-side. The browser never sees a secret.

  const connections = new Map<
    string,
    Map<string, { connectedAs: string; connectedAt: number; mode: "real" | "sandbox"; scopes: string[] }>
  >();

  app.get("/api/v1/integrations", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const licenseKey = req.lyceumAccount!.licenseKey;
    const mine = connections.get(licenseKey) ?? new Map();

    res.json({
      integrations: OAUTH_PROVIDERS.map((p) => {
        const live = mine.get(p.id);
        const configured = isProviderConfigured(p);
        return {
          id: p.id,
          name: p.name,
          emoji: p.emoji,
          blurb: p.blurb,
          auth: "oauth" as const,
          scopes: p.scopes,
          scopeLabels: p.scopeLabels,
          // Honest state: a card reads "connected" only when a connection
          // exists. Every card is connectable — either to the real provider
          // (mode: real) or through the sandbox consent flow (mode: sandbox).
          mode: configured ? "real" : "sandbox",
          state: live ? ("connected" as const) : ("available" as const),
          blockedReason: undefined,
          connectedAs: live?.connectedAs,
          connectedAt: live?.connectedAt,
          connectedMode: live?.mode,
        };
      }),
    });
  });

  app.post("/api/v1/integrations/:id/authorize", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const provider = providerFor(req.params.id);
    if (!provider) return res.status(404).json({ error: "Unknown integration." });

    const origin = `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/v1/integrations/callback`;

    // Single-use state binds this authorization to the caller's license key,
    // so the unauthenticated callback (a browser redirect) can safely complete
    // the connection for the right account. Never store the license key in the
    // URL itself — it would leak via referrers and logs.
    const state = issueAuthState({
      provider: provider.id,
      licenseKey: req.lyceumAccount!.licenseKey,
      mode: isProviderConfigured(provider) ? "real" : "sandbox",
      createdAt: Date.now(),
    });

    const outcome = buildAuthorizeUrl(provider, { origin, state, redirectUri });
    res.json({ authorizeUrl: outcome.authorizeUrl, mode: outcome.mode, notice: outcome.notice });
  });

  /** Sandbox consent page — the provider's auth screen until OAuth apps exist. */
  app.get("/api/v1/integrations/:id/sandbox-auth", async (req: express.Request, res: express.Response) => {
    const provider = providerFor(req.params.id);
    const state = String(req.query.state ?? "");
    if (!provider || !state) {
      return res.status(400).send("Invalid integration request.");
    }
    const origin = `${req.protocol}://${req.get("host")}`;
    res.type("html").send(renderAuthPage({ provider, state, origin }));
  });

  /** OAuth callback — browser redirect, so deliberately NOT authenticated. */
  app.get("/api/v1/integrations/callback", async (req: express.Request, res: express.Response) => {
    const state = String(req.query.state ?? "");
    const code = String(req.query.code ?? "");

    const auth = consumeAuthState(state);
    if (!auth) {
      return res.status(400).send("This link is invalid or has expired. Go back and try again.");
    }
    const provider = providerFor(auth.provider);
    if (!provider) {
      return res.status(400).send("Unknown integration.");
    }

    const origin = `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${origin}/api/v1/integrations/callback`;

    try {
      let connectedAs = `${provider.name} sandbox account`;
      if (auth.mode === "real") {
        if (!code) {
          return res.status(400).send(`${provider.name} returned no authorization code.`);
        }
        const exchanged = await exchangeCode(provider, code, redirectUri);
        connectedAs = exchanged.connectedAs;
      }

      const mine = connections.get(auth.licenseKey) ?? new Map();
      mine.set(provider.id, {
        connectedAs,
        connectedAt: Date.now(),
        mode: auth.mode,
        scopes: provider.scopes,
      });
      connections.set(auth.licenseKey, mine);

      // The popup flow polls the list and flips the card; this page closes
      // itself. The fallback link covers popup-blocked browsers.
      res.type("html").send(renderCallbackSuccessPage(provider.name));
    } catch (err) {
      res
        .status(502)
        .type("html")
        .send(`<h3>Connection failed</h3><p>${String(err instanceof Error ? err.message : err)}</p>`);
    }
  });

  app.delete("/api/v1/integrations/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    connections.get(req.lyceumAccount!.licenseKey)?.delete(req.params.id);
    res.json({ disconnected: true });
  });

  // ── Bring your own cloud ─────────────────────────────────────────────────

  const cloudConfigs = new Map<string, any>();

  app.get("/api/v1/cloud", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    res.json({
      config: cloudConfigs.get(req.lyceumAccount!.licenseKey) ?? {
        provider: "lyceum",
        verified: true,
      },
    });
  });

  app.get("/api/v1/workers", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const workers = await listWorkers(req.lyceumAccount!.licenseKey);
    res.json({
      ephemeralStore: isEphemeralStore(),
      workers: workers.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        departmentId: w.departmentId,
        departmentName: w.departmentName,
        model: w.model,
        tokensUsed: w.tokensUsed,
        stepsCompleted: w.stepsCompleted,
        lastSeenAt: w.lastSeenAt,
        // Full URL: this is the thing the customer pastes into their client,
        // and they will need it again every time they set up a new machine.
        mcpUrl: mcpUrlFor(req, w.mcpToken),
      })),
    });
  });

  app.post("/api/v1/workers", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { name, role, departmentId, departmentName, model } = (req.body ?? {}) as Record<string, string>;
    if (!name || !departmentId) {
      return res.status(400).json({ error: "name and departmentId are required" });
    }
    const worker = await createWorker({
      licenseKey: req.lyceumAccount!.licenseKey,
      name,
      role: role || "Assistant",
      departmentId,
      departmentName: departmentName || departmentId,
      model: model || "gpt-4o",
    });
    res.json({ worker: { ...worker, mcpUrl: mcpUrlFor(req, worker.mcpToken) } });
  });

  app.post("/api/v1/workers/:id/rotate", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const token = await rotateWorkerToken(req.lyceumAccount!.licenseKey, req.params.id);
    if (!token) return res.status(404).json({ error: "Worker not found" });
    res.json({ mcpUrl: mcpUrlFor(req, token) });
  });

  app.delete("/api/v1/workers/:id", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const ok = await revokeWorker(req.lyceumAccount!.licenseKey, req.params.id);
    if (!ok) return res.status(404).json({ error: "Worker not found" });
    res.json({ revoked: true });
  });

  // ── Missions: the shared surface the UI and connected AI both act on ────

  app.get("/api/v1/missions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const missions = await listServerMissions(
      req.lyceumAccount!.licenseKey,
      typeof req.query.department === "string" ? req.query.department : undefined
    );
    res.json({ missions: missions.map((m) => ({ ...m, progress: progressOf(m) })) });
  });

  app.post("/api/v1/missions", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { department, title, goal, headName, steps } = (req.body ?? {}) as {
      department?: string;
      title?: string;
      goal?: string;
      headName?: string;
      steps?: { title: string; ownerKind: "human" | "ai"; ownerName: string; ownerId?: string }[];
    };
    if (!department || !title) {
      return res.status(400).json({ error: "department and title are required" });
    }
    const mission = await createServerMission({
      licenseKey: req.lyceumAccount!.licenseKey,
      department,
      title,
      goal,
      headName: headName || "You",
      steps,
    });
    res.json({ mission });
  });

  app.patch("/api/v1/missions/:id/steps/:stepId", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
    const { status, note, addTokens } = (req.body ?? {}) as {
      status?: "todo" | "doing" | "done" | "blocked";
      note?: string;
      addTokens?: number;
    };
    const updated = await updateServerStep({
      licenseKey: req.lyceumAccount!.licenseKey,
      missionId: req.params.id,
      stepId: req.params.stepId,
      status,
      note,
      addTokens,
    });
    if (!updated) return res.status(404).json({ error: "Task or step not found" });
    res.json({ mission: { ...updated, progress: progressOf(updated) } });
  });

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

  return app;
}

// ── Standalone Node server ──────────────────────────────────────────────────
// Used by `npm start` (Render/Railway/Fly/etc — anything that runs a
// persistent Node process). Adds static file serving and the SPA catch-all
// on top of the shared API app. NOT used on Vercel — see server/vercel-entry.ts
// and vercel.json for that path instead. (The legacy MCP-over-WebSocket
// endpoint that used to be attached here has been removed — server/mcp/http-server.ts,
// reachable at POST /api/mcp on every deploy target, replaces it.)

async function startServer() {
  const app = createApiApp();
  const server = createServer(app);

  // Computed lazily, here only — importers that just want createApiApp()
  // (api/index.ts, tests) never touch import.meta.url this way, which
  // matters because bundling it into a CJS/ESM Vercel function otherwise
  // ties the whole module's evaluation to import.meta.url being valid.
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // ── Static files ──────────────────────────────────────────────────────
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all non-API routes
  app.get("*", (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    const configured = Object.entries(KEY_MAP).filter(([, v]) => !!v).length;
    console.log(`[Lyceum] Server running on http://localhost:${port}/`);
    console.log(`[Lyceum] MCP endpoint: POST http://localhost:${port}/api/mcp`);
    console.log(`[Lyceum] API proxy: POST http://localhost:${port}/api/chat`);
    console.log(`[Lyceum] API keys configured: ${configured}/3 domains`);
  });
}

// Only auto-start the standalone server when this file is run directly
// (`node dist/index.js`) — not when imported as a module by server/vercel-entry.ts.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  startServer().catch(console.error);
}
