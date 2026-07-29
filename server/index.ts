import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { DOMAINS, type Domain } from "../client/src/lib/modelConfig.js";
import { KEY_MAP, proxyToOpenRouter, type ProxyRequestBody } from "./lib/openrouter.js";
import { authenticateLicenseKey, type AuthedRequest } from "./lib/auth.js";
import { provisionAccount } from "./db/accounts.js";
import { getTask, listTasks } from "./db/tasks.js";
import { InsufficientCreditsError, runTask } from "./lib/runTask.js";
import { handleMcpRequest } from "./mcp/http-server.js";
import { getSupabase } from "./lib/supabase.js";

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

  // ── POST /api/webhooks/lemonsqueezy — must read the RAW body for HMAC
  // verification, so this is registered before the global express.json()
  // middleware below.
  app.post(
    "/api/webhooks/lemonsqueezy",
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
            console.error("[Lyceum] Failed to provision account for", licenseKey, err);
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

  // ── POST /api/chat — Server-side OpenRouter proxy ─────────────────────
  app.post("/api/chat", async (req: express.Request, res: express.Response) => {
    try {
      const result = await proxyToOpenRouter(req.body as ProxyRequestBody);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(502).json({ error: message });
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

  app.get("/api/v1/account", authenticateLicenseKey, (req: AuthedRequest, res: express.Response) => {
    const account = req.lyceumAccount!;
    res.json({
      product: account.product,
      organization: account.organization,
      creditsRemaining: account.creditsRemaining,
      creditsTotal: account.creditsTotal,
    });
  });

  app.post("/api/v1/chat", authenticateLicenseKey, async (req: AuthedRequest, res: express.Response) => {
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
  app.all("/api/mcp", authenticateLicenseKey, handleMcpRequest);

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
