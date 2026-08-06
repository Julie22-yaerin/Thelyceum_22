/**
 * The Lyceum server.
 *
 * Single process. Serves the marketing site and showroom, the waitlist, the
 * admin console, the JSON API, and the Lemon Squeezy webhook.
 *
 * State changes that need to happen on a schedule (locking expired
 * subscriptions) run on a simple interval — no cron, no queue. If this ever
 * runs on more than one instance, move the lock check into the webhook
 * handler so two processes cannot both act on the same expiry.
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
import { openDb, type DbHandle } from "./db.js";
import { signup, login, getUserById, getUserByEmail, verifySession, signSession, AuthError } from "./auth.js";
import { signLicense, verifyLicense } from "./license.js";
import {
  PLANS,
  ENTERPRISE_TIER,
  getPlan,
  isPlanId,
  assertVariantsConfigured,
  subscriptionDurationMs,
  WAITLIST_DEPOSIT_CENTS,
  WAITLIST_VARIANT_ID,
  LAUNCH_DATE_ISO,
  ADDON_CONNECTION_CENTS_PER_MONTH,
  ADDON_CONNECTION_VARIANT_ID,
  connectionLimitFor,
  type PlanId,
  type BillingCycle,
} from "./plans.js";
import {
  createCheckout,
  verifyWebhookSignature,
  handleWebhook,
  activateSubscription,
  getSubscription,
  getSubscriptionByLicenseKey,
  attachLicenseKey,
  validateWithLemonSqueezy,
  setAutoRenew,
  lockIfExpired,
  addAddonConnections,
  removeAddonConnections,
} from "./lemonsqueezy.js";
import { registerInstall, listInstalls, unregisterInstall, isHostType, DeviceError } from "./devices.js";
import { guideFor, previewOf } from "./guides.js";
import { PRODUCTS, OSES } from "./downloads.js";
import * as waitlist from "./waitlist.js";
import * as news from "./news.js";
import {
  authenticateAdmin,
  adminConfigured,
  recordAdminAction,
  recentAdminActions,
  authenticateDevToken,
  devTokenConfigured,
  type AdminIdentity,
} from "./admin.js";
import { mintTrialToken, activateTrial, TrialError, isLyceumIssuedKey } from "./trial.js";
import { getTelemetry } from "./telemetry.js";
import { recordUsage, monthlyUsage, budgetStatus, monthKey } from "./usage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
const SERVER_DIR = resolve(__dirname, "..", "..");
const WEB_DIR = resolve(__dirname, "web");
const DB_PATH = process.env.LYCEUM_DB_PATH ?? process.env.BRAKE_DB_PATH ?? resolve(SERVER_DIR, "data", "lyceum.db");
const JWT_SECRET = process.env.LYCEUM_JWT_SECRET ?? process.env.BRAKE_JWT_SECRET ?? randomUUID();
const PUBLIC_URL = process.env.LYCEUM_PUBLIC_URL ?? process.env.BRAKE_PUBLIC_URL ?? `http://localhost:${PORT}`;
const DEV_MODE = process.env.LYCEUM_DEV_MODE === "1" || process.env.BRAKE_DEV_MODE === "1";
/** Pre-launch: the site shows "launching soon" and only the waitlist is open. */
const LAUNCH_MODE = (process.env.LYCEUM_LAUNCH_MODE ?? "waitlist") as "waitlist" | "open";

if (DEV_MODE) {
  console.warn("[lyceum] DEV MODE — payment is bypassed, subscriptions activate without paying.");
  console.warn("[lyceum] DO NOT USE IN PRODUCTION.");
}

if (!process.env.LYCEUM_JWT_SECRET && !process.env.BRAKE_JWT_SECRET && !DEV_MODE) {
  console.warn("[lyceum] No JWT secret set — using a random ephemeral one. Sessions will not survive a restart.");
}

if (!adminConfigured()) {
  // Not fatal: a server with no admin key simply has no reachable console,
  // which is the safe default. But it is worth saying out loud, because the
  // waitlist collects applications nobody can then approve.
  console.warn("[lyceum] LYCEUM_ADMIN_KEYS is not set — the admin console is unreachable.");
}

if (!devTokenConfigured()) {
  // Same shape of trade-off as the admin key above: no token means nobody
  // can post to the waiting-room feed, which is safe but silent.
  console.warn("[lyceum] LYCEUM_DEV_TOKEN is not set — POST /api/news is unreachable.");
}

// Missing Lemon Squeezy variants are a startup failure rather than a 500 at
// checkout: a customer who clicks buy and gets an error is a lost sale we
// never hear about.
const missingVariants = assertVariantsConfigured(DEV_MODE);
// Skipped when imported by tests (LYCEUM_NO_SERVE=1): createApp is exported,
// and a non-dev test import must not be able to kill the process.
if (missingVariants.length > 0 && process.env.LYCEUM_NO_SERVE !== "1") {
  console.error(`[lyceum] Missing Lemon Squeezy variant ids: ${missingVariants.join(", ")}`);
  console.error("[lyceum] Checkout will fail until these are set. Refusing to start.");
  process.exit(1);
}

/**
 * Build the whole application against an explicit DB handle.
 *
 * Exported so tests (and any embedder) can construct the app with their own
 * database instead of the module-level one, then drive it through app.fetch().
 * All routes close over the passed handle; module-level constants like
 * JWT_SECRET are read from env at import time.
 *
 * The route bodies below are mechanically wrapped — they were written against
 * the module-level `db` and still reference it, which inside this function
 * means the parameter. Do not "fix" the indentation.
 */
export function createApp(db: DbHandle): Hono {
const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors({ origin: PUBLIC_URL, credentials: true }));

// ── Public ──────────────────────────────────────────────────────────────────

app.get("/api/telemetry", async (c) => {
  // Public on purpose: it is the measured proof behind the landing page's
  // three numbers. No auth, no sensitive data — just benchmark results.
  const t = await getTelemetry(SERVER_DIR);
  return c.json(t);
});

app.get("/api/downloads", (c) => {
  // Public: these are the MIT install commands, identical to what the open
  // source READMEs already show. The download page renders from this so the
  // web never drifts from what actually ships.
  return c.json({ products: PRODUCTS, oses: OSES });
});

app.get("/api/plans", (c) => {
  // Enterprise ships alongside the billable plans but is deliberately not one
  // of them — the client renders it as a contact card. Keeping it out of
  // `plans` means it can never be passed to checkout by accident.
  //
  // Variant ids are stripped: they are configuration, and the browser has no
  // use for them beyond what the checkout endpoint already does server-side.
  const publicPlans = PLANS.map(({ lemonSqueezyVariantIds, ...rest }) => rest);
  return c.json({
    plans: publicPlans,
    enterprise: ENTERPRISE_TIER,
    launchMode: LAUNCH_MODE,
    waitlistDepositCents: WAITLIST_DEPOSIT_CENTS,
    launchDate: LAUNCH_DATE_ISO,
    // Taken/max/full only — never the rows. The public site can show
    // "12/50 spots taken" without being able to enumerate who applied.
    waitlistAvailability: waitlist.publicAvailability(db),
    addonConnection: {
      centsPerMonth: ADDON_CONNECTION_CENTS_PER_MONTH,
      available: !!ADDON_CONNECTION_VARIANT_ID,
    },
  });
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
  // Routes that do NOT use a user session. Each is here for a specific
  // reason, not for convenience:
  //   guides       gates itself (free first step, rest needs a subscription)
  //   downloads    public on purpose — the same MIT install commands as the
  //                GitHub README; a subscription gates setup, not commands
  //   waitlist     applicants have no account yet — that is the point
  //   webhook      authenticated by HMAC signature, not by a session
  //   admin        has its own middleware below, keyed on LYCEUM_ADMIN_KEYS
  //   news         GET is public (the waiting-room feed); POST checks its
  //                own Authorization: Bearer against LYCEUM_DEV_TOKEN, a
  //                different scheme than the session JWT this middleware
  //                verifies — left to fall through here, it would 401 a
  //                correct dev-token before authenticateDevToken ever runs.
  const PUBLIC_PREFIXES = [
    "/api/guides/",
    "/api/waitlist",
    "/api/lemonsqueezy/webhook",
    "/api/admin/",
    "/dev/",
    "/api/telemetry",
    "/api/news",
  ];
  if (
    c.req.path === "/api/auth/signup" ||
    c.req.path === "/api/auth/login" ||
    c.req.path === "/api/plans" ||
    // Exact match, deliberately: the downloads data is public, but nothing
    // else under /api/downloads* should inherit that bypass.
    c.req.path === "/api/downloads" ||
    c.req.path === "/api/health" ||
    // The key Lemon Squeezy emailed is the credential — the customer may not
    // be signed in on this browser yet, so entry must be reachable anonymous.
    c.req.path === "/api/license/enter" ||
    PUBLIC_PREFIXES.some((prefix) => c.req.path.startsWith(prefix))
  ) {
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
  const limit = sub ? connectionLimitFor(sub.plan, sub.addon_connections ?? 0) : 0;
  const usage = monthlyUsage(db, userId);
  return c.json({
    user: { id: user.id, email: user.email, createdAt: user.created_at },
    subscription: sub,
    installs,
    connectionCount: installs.length,
    connectionLimit: limit,
    addonConnections: sub?.addon_connections ?? 0,
    // Budget dashboard data: what the CLIs reported this month vs the plan's
    // token budget. Null when there is no plan to budget against.
    usage: sub
      ? { ...usage, budget: budgetStatus(sub.plan, usage) }
      : { ...usage, budget: null },
  });
});

const CheckoutBody = z.object({
  plan: z.enum(["solo", "team", "scale"]),
  billing: z.enum(["monthly", "annual"]),
});

app.post("/api/subscription/checkout", async (c) => {
  // Before launch, nobody buys — the waitlist is the only way in. Enforced
  // here rather than only by hiding the button, because a hidden button is
  // not a control.
  if (LAUNCH_MODE === "waitlist") {
    return c.json(
      { error: "not_launched", message: "We haven't launched yet. Join the waitlist and we'll be in touch." },
      403
    );
  }
  const userId = c.get("userId" as never) as string;
  const userEmail = c.get("userEmail" as never) as string;
  const body = CheckoutBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  try {
    const result = await createCheckout(db, {
      userId,
      email: userEmail,
      plan: body.data.plan,
      billing: body.data.billing,
      successUrl: `${PUBLIC_URL}/web/showroom?checkout=success`,
    });
    return c.json(result);
  } catch (err) {
    console.error("[lyceum] checkout failed:", err);
    return c.json({ error: "checkout_failed", message: "Could not start checkout. Please try again." }, 502);
  }
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
  return c.json({
    token,
    plan: sub.plan,
    billing: sub.billing,
    expiresAt: sub.expires_at,
    autoRenew: sub.auto_renew === 1,
    // The key Lemon Squeezy emailed them, mirrored here so the dashboard can
    // show it without a round trip to Lemon Squeezy.
    licenseKey: sub.license_key,
  });
});

/**
 * Activate a license key the customer received by email from Lemon Squeezy.
 *
 * Confirmed with Lemon Squeezy once, here, then mirrored locally — after this
 * every check is a local lookup, so an outage on their side cannot stop a
 * paying customer's agents from running.
 */
app.post("/api/license/activate", async (c) => {
  const userId = c.get("userId" as never) as string;
  const body = z
    .object({ licenseKey: z.string().min(8).max(200) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);

  const key = body.data.licenseKey.trim();

  // One key, one account. Without this a single key could be pasted into any
  // number of accounts and each would get its own device allowance.
  const claimed = getSubscriptionByLicenseKey(db, key);
  if (claimed && claimed.user_id !== userId) {
    return c.json({ error: "already_claimed", message: "That key is already attached to another account." }, 409);
  }
  // Already mirrored for THIS user: nothing to confirm with Lemon Squeezy —
  // the mirror is the source of truth after the first validation.
  if (claimed) {
    return c.json({ ok: true, licenseKey: key });
  }

  // Same guard as /api/license/enter: a Lyceum-minted key (trial/demo) never
  // exists in Lemon Squeezy, so a failing validation would be a misleading
  // "invalid key" for a key that is genuinely ours.
  if (!DEV_MODE && isLyceumIssuedKey(key)) {
    return c.json(
      {
        error: "lyceum_key_not_mirrored",
        message:
          "That's a Lyceum-issued key (trial or demo), but it isn't registered on this instance. " +
          "Trial and demo keys only work where they were issued — use a key from your payment email instead.",
      },
      400
    );
  }

  const check = await validateWithLemonSqueezy(key);
  if (!check.valid) {
    return c.json({ error: "invalid_key", message: `That key isn't valid: ${check.note}` }, 400);
  }

  const sub = getSubscription(db, userId);
  if (!sub) {
    return c.json({ error: "no_subscription", message: "No subscription on this account yet." }, 404);
  }
  attachLicenseKey(db, userId, key);
  return c.json({ ok: true, licenseKey: key });
});

/**
 * Enter a license key from the landing page — the front door for a customer
 * who just paid.
 *
 * The key Lemon Squeezy emailed is the credential here, the same model as
 * the admin console (key-as-bearer). We confirm it once against Lemon
 * Squeezy if we don't already hold a mirror of it, resolve the account it
 * belongs to, issue a session, and tell the client whether to drop them in
 * the setup guide (nothing installed yet) or the account dashboard.
 *
 * Deliberately unauthenticated: the customer may not be signed in on this
 * browser. An optional Bearer session is honoured when present so a
 * signed-in customer's key attaches to their own account.
 */
app.post("/api/license/enter", async (c) => {
  const body = z
    .object({ licenseKey: z.string().min(8).max(200) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  const key = body.data.licenseKey.trim();

  // Optional session: if present it should own (or come to own) this key.
  const auth = c.req.header("Authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  let sessionUserId: string | null = null;
  if (match) {
    try {
      sessionUserId = verifySession(JWT_SECRET, match[1]).sub;
    } catch {
      // stale token — treat as anonymous
    }
  }

  let ownerId: string | null = null;
  let unattributable = false;

  const claimed = getSubscriptionByLicenseKey(db, key);
  if (claimed) {
    ownerId = claimed.user_id;
  } else {
    // A key Lyceum itself minted (trial or dev) never exists in Lemon Squeezy
    // — asking would answer "invalid key" for a key that is genuinely ours,
    // just not mirrored on this instance. Say what it actually is instead of
    // making the customer think their key is broken. Only in non-dev mode:
    // in dev, validateWithLemonSqueezy is a stub that accepts anything.
    if (!DEV_MODE && isLyceumIssuedKey(key)) {
      return c.json(
        {
          error: "lyceum_key_not_mirrored",
          message:
            "That's a Lyceum-issued key (trial or demo), but it isn't registered on this instance. " +
            "Trial and demo keys only work where they were issued — use a key from your payment email instead.",
        },
        400
      );
    }
    const check = await validateWithLemonSqueezy(key);
    if (!check.valid) {
      return c.json({ error: "invalid_key", message: `That key isn't valid: ${check.note}` }, 400);
    }
    // A signed-in customer with a subscription can take the key now — the
    // webhook already attributed their payment by user_id.
    if (sessionUserId) {
      const theirSub = getSubscription(db, sessionUserId);
      if (theirSub) {
        ownerId = sessionUserId;
        attachLicenseKey(db, sessionUserId, key);
      }
    }
    if (!ownerId && check.email) {
      const byEmail = getUserByEmail(db, check.email);
      if (byEmail) {
        const theirSub = getSubscription(db, byEmail.id);
        if (theirSub) {
          ownerId = byEmail.id;
          attachLicenseKey(db, byEmail.id, key);
        } else {
          // Account exists but the payment hasn't landed as a subscription
          // row yet — fall through to the "try again" branch below.
          unattributable = true;
        }
      }
    }
    if (!ownerId) {
      // Paid, but no account we can match it to. The client holds the key
      // and asks them to sign in with the email that paid.
      const email = check.email ?? null;
      return c.json(
        {
          ok: true,
          needsAccount: true,
          email,
          message: unattributable
            ? "We found your payment, but it hasn't been linked to your account yet. Try again in a minute."
            : email
              ? `We found your payment under ${email}. Create or sign into an account with that email to finish setup.`
              : "We couldn't match this key to an account yet. Try again in a minute.",
        },
        200
      );
    }
  }

  // One key, one account.
  if (sessionUserId && sessionUserId !== ownerId) {
    return c.json({ error: "already_claimed", message: "That key is already attached to another account." }, 409);
  }

  const user = getUserById(db, ownerId)!;
  const sub = getSubscription(db, ownerId);
  const installs = listInstalls(db, ownerId);
  const usage = monthlyUsage(db, ownerId);
  return c.json({
    ok: true,
    sessionToken: signSession(JWT_SECRET, user),
    user: { id: user.id, email: user.email },
    subscription: sub,
    connectionLimit: sub ? connectionLimitFor(sub.plan, sub.addon_connections ?? 0) : 0,
    installs,
    needsSetup: installs.length === 0,
    route: installs.length === 0 ? "setup" : "dashboard",
    usage: sub ? { ...usage, budget: budgetStatus(sub.plan, usage) } : { ...usage, budget: null },
  });
});

// ── Usage reporting (from the licensed CLIs) ────────────────────────────────
// Best-effort, off the hot path: each CLI sends a bounded summary (tokens
// processed, calls guarded) after a scan / challenge / measure. The endpoint
// aggregates per user per month; the dashboard renders used vs budget.

const UsageReportBody = z.object({
  tool: z.enum(["brake", "redteam", "thrift"]),
  kind: z.string().min(1).max(40),
  tokens: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  calls: z.number().int().nonnegative().max(1_000_000_000).optional(),
});

app.post("/api/usage/report", async (c) => {
  const userId = c.get("userId" as never) as string;
  const body = UsageReportBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input", issues: body.error.issues }, 400);

  recordUsage(db, userId, {
    tool: body.data.tool,
    kind: body.data.kind,
    tokens: body.data.tokens ?? 0,
    calls: body.data.calls ?? 0,
  });

  const sub = getSubscription(db, userId);
  const usage = monthlyUsage(db, userId);

  // Cloud BYOC Trial Limit Check
  if (sub && sub.status === "active" && sub.license_key?.startsWith("LYCEUM-TRIAL-")) {
    if (usage.calls >= 10) {
      db.raw.prepare("UPDATE subscriptions SET status = 'locked', locked_at = ? WHERE id = ?").run(Date.now(), sub.id);
      sub.status = "locked";
    }
  }

  return c.json({
    ok: true,
    month: monthKey(),
    usage: sub ? { ...usage, budget: budgetStatus(sub.plan, usage) } : { ...usage, budget: null },
  });
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

// ── Lemon Squeezy webhook ───────────────────────────────────────────────────
// Raw body, because the HMAC is over the exact bytes sent — re-serialising
// parsed JSON produces different bytes and the signature never matches.

app.post("/api/lemonsqueezy/webhook", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-signature");

  if (!verifyWebhookSignature(raw, sig)) {
    // This endpoint grants subscriptions. An unverified POST to it is someone
    // trying to issue themselves a plan, so it is refused before parsing.
    console.warn("[lyceum] rejected a webhook with a bad or missing signature");
    return c.json({ error: "bad_signature" }, 401);
  }

  try {
    const payload = JSON.parse(raw) as {
      meta?: { event_name?: string; custom_data?: Record<string, unknown> };
      data?: { id?: string; attributes?: Record<string, unknown> };
    };
    const attrs = payload.data?.attributes ?? {};
    const eventName = payload.meta?.event_name ?? "";

    // A waitlist deposit is a one-off order against its own variant, so it is
    // handled here rather than in the subscription path.
    const variantId = String(attrs.variant_id ?? (attrs.first_order_item as { variant_id?: unknown } | undefined)?.variant_id ?? "");
    if (WAITLIST_VARIANT_ID && variantId === WAITLIST_VARIANT_ID && eventName === "order_created") {
      const email = String(attrs.user_email ?? "");
      const cents = Number(attrs.total ?? WAITLIST_DEPOSIT_CENTS);
      const row = waitlist.markDepositPaid(db, email, cents, payload.data?.id ?? null);
      return c.json({ ok: true, waitlist: row ? row.status : "no matching application" });
    }

    // Add-on connections are their own variant. Handled before the plan path
    // so an add-on order is never mistaken for a plan change.
    if (ADDON_CONNECTION_VARIANT_ID && variantId === ADDON_CONNECTION_VARIANT_ID) {
      const userId = payload.meta?.custom_data?.user_id as string | undefined;
      if (!userId) {
        return c.json({ ok: true, note: "add-on order with no user_id; cannot attribute" });
      }
      const qty = Number((attrs.first_order_item as { quantity?: unknown } | undefined)?.quantity ?? 1);
      if (eventName === "order_created" || eventName === "subscription_created") {
        const total = addAddonConnections(db, userId, qty);
        return c.json({ ok: true, addonConnections: total });
      }
      if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
        const total = removeAddonConnections(db, userId, qty);
        return c.json({ ok: true, addonConnections: total });
      }
      return c.json({ ok: true, note: `add-on event ${eventName} ignored` });
    }

    const outcome = await handleWebhook(db, raw);
    // Always 200 on a verified webhook we simply don't act on — a non-2xx
    // makes Lemon Squeezy retry an event that will never succeed.
    return c.json({ ok: true, ...outcome });
  } catch (err) {
    console.error("[lyceum] webhook processing failed:", err);
    return c.json({ error: "webhook_error" }, 500);
  }
});

// ── Waitlist ────────────────────────────────────────────────────────────────

app.post("/api/waitlist", async (c) => {
  const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const errors = waitlist.validateApplication({
    name: String(raw.name ?? ""),
    organisation: String(raw.organisation ?? ""),
    workEmail: String(raw.workEmail ?? ""),
    phone: String(raw.phone ?? ""),
  });
  if (errors.length > 0) return c.json({ error: "invalid_input", errors }, 400);

  try {
    const row = waitlist.apply(db, {
      name: String(raw.name),
      organisation: String(raw.organisation),
      workEmail: String(raw.workEmail),
      phone: String(raw.phone),
      fleetSize: raw.fleetSize ? String(raw.fleetSize) : undefined,
      note: raw.note ? String(raw.note) : undefined,
    });

    // The deposit link, if a variant is configured. Without one the
    // application still lands — it just sits at `pending` until an operator
    // takes payment some other way, which is better than losing the lead.
    const depositUrl = WAITLIST_VARIANT_ID
      ? `https://${process.env.LEMONSQUEEZY_STORE_SLUG ?? "thelyceum"}.lemonsqueezy.com/buy/${WAITLIST_VARIANT_ID}?checkout[email]=${encodeURIComponent(row.work_email)}`
      : null;

    return c.json({
      ok: true,
      id: row.id,
      status: row.status,
      depositCents: WAITLIST_DEPOSIT_CENTS,
      depositUrl,
    }, 201);
  } catch (err) {
    if (err instanceof waitlist.WaitlistError) {
      const status =
        err.code === "already_applied" ? 409 : err.code === "waitlist_full" || err.code === "waitlist_closed" ? 403 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

app.get("/api/waitlist/availability", (c) => {
  return c.json(waitlist.publicAvailability(db));
});

app.get("/api/waitlist/status", (c) => {
  const email = c.req.query("email");
  if (!email) return c.json({ error: "email required" }, 400);
  const row = waitlist.getByEmail(db, email);
  // Only the status, never the record: this endpoint takes an email and needs
  // no authentication, so returning the row would let anyone enumerate who
  // else has applied and from which company.
  return c.json({ found: !!row, status: row?.status ?? null });
});

// ── News (waiting-room feed) ─────────────────────────────────────────────────
// Read is public — it's what a paid, waiting applicant sees at /web/news-out.
// Write needs LYCEUM_DEV_TOKEN, checked the same timing-safe way as admin
// keys, but kept as its own credential — see authenticateDevToken in admin.ts.

app.get("/api/news", (c) => {
  return c.json({ entries: news.list(db, Number(c.req.query("limit")) || 50) });
});

const NewsBody = z.object({
  category: z.enum(["progress", "test", "benchmark"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

app.post("/api/news", async (c) => {
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.match(/^Bearer (.+)$/)?.[1];
  if (!authenticateDevToken(token)) return c.json({ error: "unauthorized" }, 401);

  const body = NewsBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input", issues: body.error.issues }, 400);

  const row = news.publish(db, body.data);
  return c.json({ entry: row }, 201);
});

// ── Admin console ───────────────────────────────────────────────────────────
// Authenticated by a license key from LYCEUM_ADMIN_KEYS — never from the
// database, so a leaked backup or a SQL injection is not an admin takeover.

app.use("/api/admin/*", async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  const key = auth.match(/^Bearer (.+)$/)?.[1];
  const identity = authenticateAdmin(key);
  if (!identity) return c.json({ error: "unauthorized" }, 401);
  c.set("admin" as never, identity as never);
  await next();
});

app.get("/api/admin/waitlist", (c) => {
  const status = c.req.query("status") as waitlist.ListOptions["status"];
  return c.json({
    entries: waitlist.list(db, { status, limit: Number(c.req.query("limit")) || 200 }),
    counts: waitlist.counts(db),
  });
});

app.post("/api/admin/waitlist/:id/status", async (c) => {
  const admin = c.get("admin" as never) as { fingerprint: string };
  const body = z
    .object({ status: z.enum(["pending", "paid", "approved", "rejected"]) })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);

  const row = waitlist.setStatus(db, c.req.param("id"), body.data.status, admin.fingerprint);
  if (!row) return c.json({ error: "not_found" }, 404);

  recordAdminAction(db, admin, "waitlist.status", {
    id: row.id,
    organisation: row.organisation,
    to: body.data.status,
  });
  return c.json({ entry: row });
});

app.get("/api/admin/audit", (c) => {
  return c.json({ entries: recentAdminActions(db, Number(c.req.query("limit")) || 50) });
});

// ── Trial (30-day pre-release cohort, see TRIAL_PLAN.md) ───────────────────
// Minting is an admin act (paid/approved waitlist only, audit-logged);
// redemption is a signed-in member of the cohort redeeming their own token.

const TrialMintBody = z.object({
  email: z.string().email(),
  plan: z.enum(["solo", "team", "scale"]).optional(),
});

app.post("/api/admin/trial/tokens", async (c) => {
  const admin = c.get("admin" as never) as AdminIdentity;
  const body = TrialMintBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  try {
    const minted = mintTrialToken(db, JWT_SECRET, admin, body.data);
    return c.json({ ok: true, ...minted });
  } catch (err) {
    if (err instanceof TrialError) {
      const status = err.code === "not_in_cohort" ? 403 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

const TrialActivateBody = z.object({ token: z.string().min(1) });

app.post("/api/trial/activate", async (c) => {
  const userId = c.get("userId" as never) as string;
  const userEmail = c.get("userEmail" as never) as string;
  const body = TrialActivateBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "invalid_input" }, 400);
  try {
    const activated = activateTrial(db, JWT_SECRET, {
      userId,
      email: userEmail,
      token: body.data.token,
    });
    return c.json({ ok: true, ...activated });
  } catch (err) {
    if (err instanceof TrialError) {
      const status = err.code === "already_used" || err.code === "has_subscription" ? 409 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

// ── Dev activation (BRAKE_DEV_MODE only) ────────────────────────────────────

app.get("/dev/activate", (c) => {
  if (!DEV_MODE) return c.json({ error: "not_found" }, 404);
  const plan = c.req.query("plan");
  const billing = c.req.query("billing") as BillingCycle | undefined;
  const userId = c.req.query("user_id");
  if (!isPlanId(plan) || !billing || !userId) {
    return c.json({ error: "missing_params" }, 400);
  }
  const durationMs = Number(c.req.query("duration_ms") ?? subscriptionDurationMs(billing));
  activateSubscription(db, {
    userId,
    plan,
    billing,
    expiresAt: Date.now() + durationMs,
    // A recognisable fake so a dev-mode key is never mistaken for a real one
    // if it turns up in a bug report or a screenshot.
    licenseKey: `LYCEUM-DEV-${userId.slice(0, 8).toUpperCase()}`,
  });
  return c.redirect(`/web/showroom?checkout=success&dev=1`);
});

// ── Setup guides ─────────────────────────────────────────────────────────
// Both products are behind the same subscription. An unauthenticated or
// unlicensed request gets the first step only — real and working, not a
// teaser — and the rest requires an active subscription.

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
              : filePath.endsWith(".svg") ? "image/svg+xml"
              : "application/octet-stream";
    return c.body(data, 200, { "Content-Type": type });
  }
  return c.text("not found", 404);
});

return app;
}

// ── Lifecycle — only when run as the server, never when imported by tests ──
// Tests build their own app via createApp() with a temp DB; the guard below
// keeps this module side-effect-free when imported. Set LYCEUM_NO_SERVE=1 to
// import without starting a listener.
if (process.env.LYCEUM_NO_SERVE !== "1") {
const db = openDb(DB_PATH);
const app = createApp(db);

setInterval(() => {
  try {
    const n = lockIfExpired(db);
    if (n > 0) console.log(`[lyceum] locked ${n} expired subscription(s) with auto-renew off.`);
  } catch (err) {
    console.error("[lyceum] lockIfExpired error:", err);
  }
}, 60_000);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[lyceum] listening on http://localhost:${info.port}`);
  console.log(`[lyceum] site:     ${PUBLIC_URL}/web/`);
  console.log(`[lyceum] showroom: ${PUBLIC_URL}/web/showroom`);
  console.log(`[lyceum] admin:    ${PUBLIC_URL}/web/admin`);
  console.log(
    `[lyceum] plans:    ` +
      PLANS.map((p) => `${p.name} $${p.pricesCentsPerMonth.monthly / 100}/mo (${p.aiConnections})`).join(" · ")
  );
  console.log(`[lyceum] mode:     ${LAUNCH_MODE === "waitlist" ? "PRE-LAUNCH (waitlist only)" : "open for signups"}`);
  if (DEV_MODE) console.log(`[lyceum] DEV MODE: payment bypassed.`);
});
}
