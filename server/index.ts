import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { MODEL_ROUTES, type Domain } from "../client/src/lib/modelConfig";
import { attachMcpWebSocket } from "./mcp/lyceum-mcp-server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Server-side key resolution ───────────────────────────────────────────────
// These read from process.env directly — NEVER shipped to the browser.
// Prefer the non-VITE_ keys (pure server-side), fall back to VITE_ (legacy).

const KEY_MAP: Record<Domain, string> = {
  LAW:   process.env.OPENROUTER_KEY_LAW   || process.env.VITE_OPENROUTER_KEY_LAW   || "",
  FINANCE: process.env.OPENROUTER_KEY_FINANCE || process.env.VITE_OPENROUTER_KEY_FINANCE || "",
  TECH:  process.env.OPENROUTER_KEY_TECH  || process.env.VITE_OPENROUTER_KEY_TECH  || "",
  MUSE:  process.env.OPENROUTER_KEY_MUSE  || process.env.VITE_OPENROUTER_KEY_MUSE  || "",
};

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

// ── OpenRouter Proxy ─────────────────────────────────────────────────────────

interface ProxyRequestBody {
  domain: Domain;
  messages: { role: string; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

async function proxyToOpenRouter(body: ProxyRequestBody): Promise<unknown> {
  const { domain, messages, temperature, maxTokens } = body;

  const apiKey = KEY_MAP[domain];
  if (!apiKey) {
    throw new Error(`No API key configured for domain "${domain}"`);
  }

  const route = MODEL_ROUTES[domain];
  if (!route) {
    throw new Error(`Unknown domain "${domain}"`);
  }

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://lyceum.internal",
      "X-Title": "The Lyceum",
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new Error(`OpenRouter (${domain}) returned ${response.status}: ${text}`);
  }

  return response.json();
}

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

// ── Server ───────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Attach MCP WebSocket endpoint on the same HTTP server
  attachMcpWebSocket(server);

  // ── POST /api/webhooks/lemonsqueezy — must read the RAW body for HMAC
  // verification, so this is registered before the global express.json()
  // middleware below.
  app.post(
    "/api/webhooks/lemonsqueezy",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res) => {
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
        orders.set(ref, {
          ...existing,
          status: "paid",
          licenseKey: payload?.data?.attributes?.key,
          product: payload?.data?.attributes?.product_name,
          email: payload?.data?.attributes?.user_email ?? existing?.email,
          name: customData?.name ?? existing?.name,
          organization: customData?.organization ?? existing?.organization,
          paidAt: Date.now(),
        });
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
  app.get("/api/orders/:ref", (req, res) => {
    const order = orders.get(req.params.ref);
    res.json(order ?? { status: "pending" });
  });

  // ── GET /api/beta-slots — public live counter for the landing page ─────
  app.get("/api/beta-slots", (_req, res) => {
    const paidCount = Array.from(orders.values()).filter((o) => o.status === "paid").length;
    const claimed = Math.min(BETA_SLOT_BASELINE + paidCount, BETA_SLOT_CAP);
    res.json({ claimed, cap: BETA_SLOT_CAP });
  });

  // ── GET /api/admin/orders — customers, orgs, license keys (token-gated) ─
  app.get("/api/admin/orders", requireAdmin, (_req, res) => {
    const list = Array.from(orders.entries())
      .map(([ref, order]) => ({ ref, ...order }))
      .sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
    res.json({ orders: list });
  });

  // ── Middleware ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: "1mb" }));

  // ── POST /api/chat — Server-side OpenRouter proxy ─────────────────────
  app.post("/api/chat", async (req, res) => {
    try {
      const result = await proxyToOpenRouter(req.body as ProxyRequestBody);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(502).json({ error: message });
    }
  });

  // ── GET /api/health — Server health check ─────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      domains: Object.keys(KEY_MAP),
      keysConfigured: Object.entries(KEY_MAP)
        .filter(([, v]) => !!v)
        .map(([k]) => k),
      mcpEndpoint: "/mcp",
      timestamp: Date.now(),
    });
  });

  // ── Static files ──────────────────────────────────────────────────────
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all non-API routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    const configured = Object.entries(KEY_MAP).filter(([, v]) => !!v).length;
    console.log(`[Lyceum] Server running on http://localhost:${port}/`);
    console.log(`[Lyceum] MCP WebSocket endpoint: ws://localhost:${port}/mcp`);
    console.log(`[Lyceum] API proxy: POST http://localhost:${port}/api/chat`);
    console.log(`[Lyceum] API keys configured: ${configured}/3 domains`);
    console.log(`[Lyceum] MCP tools available: lyceum_agents_list, lyceum_agent_get_status, lyceum_agent_recharge, lyceum_pipeline_run, lyceum_comment_add, lyceum_suggestions_get, lyceum_suggestion_inject, lyceum_execution_logs`);
  });
}

startServer().catch(console.error);
