/**
 * The license server.
 *
 * Single process. Serves the web UI (pricing + dashboard) at /, the JSON
 * API at /api/*, and a dev-only activation endpoint at /dev/* when
 * BRAKE_DEV_MODE=1.
 *
 * State changes that need to happen on a schedule (locking expired subs)
 * run on a simple interval — no cron, no queue, just setInterval. If this
 * server is the only one running, that's fine; if you ever scale horizontally,
 * move the lock check into the webhook handler.
 */

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openDb } from "./db.js";
import { signup, login, getUserById, verifySession, AuthError } from "./auth.js";
import { signLicense, verifyLicense } from "./license.js";
import { PLANS, ENTERPRISE_TIER, getPlan, type PlanId, type BillingCycle } from "./plans.js";
import {
  createCheckoutSession,
  handleWebhookEvent,
  activateSubscription,
  getSubscription,
  setAutoRenew,
  lockIfExpired,
} from "./stripe.js";
import { registerInstall, listInstalls, unregisterInstall, isHostType, DeviceError } from "./devices.js";
import { guideFor, previewOf } from "./guides.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const SERVER_DIR = resolve(__dirname, "..", "..");
const WEB_DIR = resolve(__dirname, "web");
const DB_PATH = process.env.BRAKE_DB_PATH ?? resolve(SERVER_DIR, "data", "brake.db");
const JWT_SECRET = process.env.BRAKE_JWT_SECRET ?? randomUUID();
const PUBLIC_URL = process.env.BRAKE_PUBLIC_URL ?? `http://localhost:${PORT}`;
const DEV_MODE = process.env.BRAKE_DEV_MODE === "1";

if (DEV_MODE) {
  console.warn("[brake-server] BRAKE_DEV_MODE=1 — Stripe is bypassed, subscriptions activate without payment.");
  console.warn("[brake-server] DO NOT USE IN PRODUCTION.");
}

if (JWT_SECRET === process.env.BRAKE_JWT_SECRET) {
  // Allow a default secret in dev so the server can boot without env vars,
  // but warn loudly. In production, set BRAKE_JWT_SECRET.
  if (!DEV_MODE) console.warn("[brake-server] BRAKE_JWT_SECRET is not set — using a random ephemeral secret. Sessions will not survive restarts.");
}

const db = openDb(DB_PATH);

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: PUBLIC_URL, credentials: true }));

// ── Public ──────────────────────────────────────────────────────────────────

app.get("/api/plans", (c) => {
  // Enterprise ships alongside the billable plans but is deliberately not one
  // of them — the client renders it as a contact card. Keeping it out of
  // `plans` means it can never be passed to checkout by accident.
  return c.json({ plans: PLANS, enterprise: ENTERPRISE_TIER });
});

app.get("/api/health", (c) => c.json({ ok: true, devMode: DEV_MODE }));

// ── Auth ────────────────────────────────────────────────────────────────────

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

app.post("/api/auth/signup", async (c) => {
  const body = SignupBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input", issues: body.error.issues }, 400);
  try {
    const result = signup(db, JWT_SECRET, body.data);
    return c.json({ sessionToken: result.sessionToken, user: { id: result.user.id, email: result.user.email } });
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.code, message: err.message }, 400);
    throw err;
  }
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post("/api/auth/login", async (c) => {
  const body = LoginBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  try {
    const result = login(db, JWT_SECRET, body.data);
    return c.json({ sessionToken: result.sessionToken, user: { id: result.user.id, email: result.user.email } });
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.code, message: err.message }, 401);
    throw err;
  }
});

// ── Authenticated routes ────────────────────────────────────────────────────

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/auth/signup" || c.req.path === "/api/auth/login"
      || c.req.path === "/api/plans" || c.req.path === "/api/health"
      || c.req.path.startsWith("/api/stripe/webhook")
      || c.req.path.startsWith("/api/guides/")
      || c.req.path.startsWith("/dev/")) {
    return next();
  }
  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return c.json({ error: "unauthenticated" }, 401);
  try {
    const session = verifySession(JWT_SECRET, match[1]);
    const user = getUserById(db, session.sub);
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    c.set("userId" as never, user.id as never);
    c.set("userEmail" as never, user.email as never);
    await next();
  } catch {
    return c.json({ error: "unauthenticated" }, 401);
  }
});

app.get("/api/me", (c) => {
  const userId = c.get("userId" as never) as string;
  const user = getUserById(db, userId)!;
  const sub = getSubscription(db, userId);
  const installs = listInstalls(db, userId);
  const limit = sub ? getPlan(sub.plan).aiConnections : 0;
  return c.json({
    user: { id: user.id, email: user.email, createdAt: user.created_at },
    subscription: sub,
    installs,
    connectionCount: installs.length,
    connectionLimit: limit,
  });
});

const CheckoutBody = z.object({
  plan: z.enum(["team", "business"]),
  billing: z.enum(["monthly", "annual"]),
});

app.post("/api/subscription/checkout", async (c) => {
  const userId = c.get("userId" as never) as string;
  const userEmail = c.get("userEmail" as never) as string;
  const body = CheckoutBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  const result = await createCheckoutSession(db, {
    userId,
    email: userEmail,
    plan: body.data.plan,
    billing: body.data.billing,
    successUrl: `${PUBLIC_URL}/?checkout=success`,
    cancelUrl: `${PUBLIC_URL}/?checkout=cancel`,
  });
  return c.json(result);
});

const AutoRenewBody = z.object({ enabled: z.boolean() });

app.post("/api/subscription/auto-renew", async (c) => {
  const userId = c.get("userId" as never) as string;
  const body = AutoRenewBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  setAutoRenew(db, userId, body.data.enabled);
  return c.json({ ok: true });
});

app.get("/api/license", (c) => {
  const userId = c.get("userId" as never) as string;
  const user = getUserById(db, userId)!;
  const sub = getSubscription(db, userId);
  if (!sub) return c.json({ error: "no_subscription" }, 404);
  if (sub.status !== "active") return c.json({ error: "subscription_not_active", status: sub.status }, 402);
  if (sub.expires_at < Date.now() && sub.auto_renew === 0) return c.json({ error: "expired" }, 402);
  const token = signLicense(JWT_SECRET, {
    userId: user.id,
    email: user.email,
    plan: sub.plan as PlanId,
    billing: sub.billing as BillingCycle,
    status: "active",
    expiresAt: sub.expires_at,
    autoRenew: sub.auto_renew === 1,
  });
  return c.json({ token, plan: sub.plan, billing: sub.billing, expiresAt: sub.expires_at, autoRenew: sub.auto_renew === 1 });
});

const RegisterBody = z.object({
  hostType: z.string(),
  deviceId: z.string().min(1).max(200),
  hostMeta: z.record(z.unknown()).optional(),
});

app.post("/api/installs/register", async (c) => {
  const userId = c.get("userId" as never) as string;
  const body = RegisterBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input", issues: body.error.issues }, 400);
  if (!isHostType(body.data.hostType)) return c.json({ error: "invalid_host" }, 400);
  try {
    const result = registerInstall(db, {
      userId,
      hostType: body.data.hostType,
      deviceId: body.data.deviceId,
      hostMeta: body.data.hostMeta,
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof DeviceError) {
      const status = err.code === "limit_reached" ? 402 : 403;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

app.get("/api/installs", (c) => {
  const userId = c.get("userId" as never) as string;
  const installs = listInstalls(db, userId);
  const sub = getSubscription(db, userId);
  const limit = sub ? getPlan(sub.plan).aiConnections : 0;
  return c.json({ installs, total: installs.length, limit });
});

app.delete("/api/installs/:id", (c) => {
  const userId = c.get("userId" as never) as string;
  const ok = unregisterInstall(db, userId, c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

app.post("/api/license/validate", async (c) => {
  const body = z.object({ token: z.string() }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  try {
    const payload = verifyLicense(JWT_SECRET, body.data.token);
    return c.json({ ok: true, payload });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : "invalid" }, 401);
  }
});

// ── Stripe webhook (raw body) ───────────────────────────────────────────────

app.post("/api/stripe/webhook", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("stripe-signature");
  try {
    await handleWebhookEvent(db, raw, sig);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "webhook_error" }, 400);
  }
});

// ── Dev activation (BRAKE_DEV_MODE only) ────────────────────────────────────

app.get("/dev/activate", (c) => {
  if (!DEV_MODE) return c.json({ error: "not_found" }, 404);
  const sessionId = c.req.query("session_id");
  const plan = c.req.query("plan") as PlanId | undefined;
  const billing = c.req.query("billing") as BillingCycle | undefined;
  const userId = c.req.query("user_id");
  const durationMs = Number(c.req.query("duration_ms") ?? 30 * 24 * 60 * 60 * 1000);
  if (!sessionId || !plan || !billing || !userId) {
    return c.json({ error: "missing_params" }, 400);
  }
  activateSubscription(db, { userId, plan, billing, durationMs });
  return c.redirect(`/?checkout=success&dev=1`);
});

// ── Setup guides ─────────────────────────────────────────────────────────
// redteam is free end to end, so its guide is public. brake is the paid
// product: an unauthenticated or unlicensed request gets the first step only
// — real and working, not a teaser — and the rest requires an active
// subscription, checked the same way /download/cli checks it.

app.get("/api/guides/:product", async (c) => {
  const guide = guideFor(c.req.param("product"));
  if (!guide) return c.json({ error: "not_found" }, 404);
  if (!guide.gated) return c.json({ guide, unlocked: true });

  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return c.json({ guide: previewOf(guide), unlocked: false, reason: "login_required" });
  try {
    const session = verifySession(JWT_SECRET, match[1]);
    const sub = getSubscription(db, session.sub);
    if (!sub || sub.status !== "active") {
      return c.json({ guide: previewOf(guide), unlocked: false, reason: "subscription_required" });
    }
    return c.json({ guide, unlocked: true });
  } catch {
    return c.json({ guide: previewOf(guide), unlocked: false, reason: "login_required" });
  }
});

// ── CLI download (gated by active subscription) ────────────────────────────

app.get("/download/cli", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return c.text("login required", 401);
  try {
    const session = verifySession(JWT_SECRET, match[1]);
    const sub = getSubscription(db, session.sub);
    if (!sub || sub.status !== "active") return c.text("active subscription required", 402);
  } catch {
    return c.text("login required", 401);
  }
  const tarballPath = resolve(SERVER_DIR, "dist-cli.tar.gz");
  if (!existsSync(tarballPath)) {
    return c.text("CLI tarball not built; run `npm run build && tar -czf dist-cli.tar.gz dist package.json README.md LICENSE skills` on the server.", 501);
  }
  const data = readFileSync(tarballPath);
  return c.body(data, 200, { "Content-Type": "application/gzip", "Content-Disposition": 'attachment; filename="brake-cli.tar.gz"' });
});

// ── Static web ──────────────────────────────────────────────────────────────

app.use("/web/*", serveStatic({ root: "./", rewriteRequestPath: (p) => p.replace(/^\/web/, "/web") }));
app.get("/", (c) => c.redirect("/web/"));

// Fallback: serve the SPA shell for any /web/* path that doesn't match a file
app.get("/web/*", async (c) => {
  // "" (bare /web) and any path ending in "/" mean "serve index.html here" —
  // resolving straight to the directory and reading it as a file throws
  // EISDIR. This was latent rather than caught earlier because the build
  // did not copy static assets into dist-server, so /web/ 404'd before it
  // could reach this bug; fixing the build script surfaced it.
  let reqPath = c.req.path.replace(/^\/web/, "");
  if (reqPath === "" || reqPath.endsWith("/")) reqPath += "index.html";
  // Pretty URLs: /web/showroom → showroom.html. Only when the bare path has
  // no extension and no such file exists, so a real extensionless asset would
  // still win.
  else if (!reqPath.includes(".") && !existsSync(join(WEB_DIR, reqPath))) reqPath += ".html";
  const filePath = join(WEB_DIR, reqPath);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const data = readFileSync(filePath);
    const type = filePath.endsWith(".html") ? "text/html; charset=utf-8"
              : filePath.endsWith(".js") ? "application/javascript"
              : filePath.endsWith(".css") ? "text/css; charset=utf-8"
              : "application/octet-stream";
    return c.body(data, 200, { "Content-Type": type });
  }
  return c.text("not found", 404);
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

setInterval(() => {
  try {
    const n = lockIfExpired(db);
    if (n > 0) console.log(`[brake-server] locked ${n} expired subscription(s) with auto-renew off.`);
  } catch (err) {
    console.error("[brake-server] lockIfExpired error:", err);
  }
}, 60_000);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[brake-server] listening on http://localhost:${info.port}`);
  console.log(`[brake-server] web UI:   ${PUBLIC_URL}/`);
  console.log(`[brake-server] API:      ${PUBLIC_URL}/api/`);
  console.log(`[brake-server] plans:    Starter $9/mo (3 AI) · Pro $29/mo (10 AI) — annual ~20% off`);
  if (DEV_MODE) console.log(`[brake-server] DEV MODE: Stripe bypassed, no payment required.`);
});
