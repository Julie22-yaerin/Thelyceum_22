/**
 * Lemon Squeezy — checkout, webhooks, and license keys.
 *
 * ── Why Lemon Squeezy and not Stripe ────────────────────────────────────────
 * Two reasons that actually matter here. It is a merchant of record, so it
 * handles VAT/sales tax across jurisdictions instead of leaving that to us —
 * which is the difference between being able to sell to an EU company today
 * and not. And it issues license keys natively, so the key the customer pastes
 * into `brake login` is delivered by the same email that confirms their
 * payment, with no separate delivery system to build and no window where they
 * have paid but have nothing to use.
 *
 * ── Where the license key comes from ────────────────────────────────────────
 * Lemon Squeezy generates it and emails it. We mirror it into our own database
 * on the webhook so that day-to-day validation is a local lookup rather than
 * an API call to them on every check — an outage on their side must not stop a
 * paying customer's agents from running. `validateWithLemonSqueezy` exists for
 * the initial activation, where confirming the key is genuinely theirs is
 * worth one round trip.
 *
 * ── Signature verification is not optional ──────────────────────────────────
 * The webhook endpoint is a public URL that grants subscriptions. Without HMAC
 * verification anyone who finds it can POST themselves a free Enterprise plan.
 * `verifyWebhookSignature` uses a timing-safe compare and the handler refuses
 * to process anything that fails it.
 */

import crypto, { randomUUID } from "node:crypto";
import type { DbHandle, SubscriptionRow } from "./db.js";
import {
  getPlan,
  planForVariant,
  subscriptionDurationMs,
  type BillingCycle,
  type PlanId,
} from "./plans.js";

const DEV_MODE = process.env.LYCEUM_DEV_MODE === "1" || process.env.BRAKE_DEV_MODE === "1";

const LS_API = "https://api.lemonsqueezy.com/v1";

function apiKey(): string {
  const key = process.env.LEMONSQUEEZY_API_KEY;
  if (!key) throw new Error("LEMONSQUEEZY_API_KEY is not set");
  return key;
}

// ── Checkout ────────────────────────────────────────────────────────────────

export interface CreateCheckoutInput {
  userId: string;
  email: string;
  plan: PlanId;
  billing: BillingCycle;
  successUrl: string;
}

export interface CreateCheckoutResult {
  url: string;
  devMode: boolean;
}

/**
 * Build a hosted checkout URL.
 *
 * `custom` data rides along and comes back on the webhook — that is how we
 * connect a Lemon Squeezy order to the account that started it. Without it we
 * would be matching on email, which breaks the moment someone pays with a
 * different address than they signed up with.
 */
export async function createCheckout(
  db: DbHandle,
  input: CreateCheckoutInput
): Promise<CreateCheckoutResult> {
  const plan = getPlan(input.plan);
  const durationMs = subscriptionDurationMs(input.billing);

  if (DEV_MODE) {
    return {
      url: `/dev/activate?plan=${input.plan}&billing=${input.billing}&user_id=${input.userId}&duration_ms=${durationMs}`,
      devMode: true,
    };
  }

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = plan.lemonSqueezyVariantIds[input.billing];
  if (!storeId) throw new Error("LEMONSQUEEZY_STORE_ID is not set");
  if (!variantId) {
    throw new Error(
      `No Lemon Squeezy variant configured for ${input.plan}/${input.billing}. ` +
        `Set LS_VARIANT_${input.plan.toUpperCase()}_${input.billing.toUpperCase()}.`
    );
  }

  const res = await fetch(`${LS_API}/checkouts`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: input.email,
            custom: { user_id: input.userId, plan: input.plan, billing: input.billing },
          },
          product_options: { redirect_url: input.successUrl },
        },
        relationships: {
          store: { data: { type: "stores", id: String(storeId) } },
          variant: { data: { type: "variants", id: String(variantId) } },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Lemon Squeezy checkout failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { data?: { attributes?: { url?: string } } };
  const url = body.data?.attributes?.url;
  if (!url) throw new Error("Lemon Squeezy returned no checkout URL");
  return { url, devMode: false };
}

// ── Webhook ─────────────────────────────────────────────────────────────────

/**
 * HMAC-SHA256 over the raw body, timing-safe compared.
 *
 * The raw body matters: re-serialising the parsed JSON produces different
 * bytes and the signature will never match. The route reads `c.req.text()`
 * for exactly this reason.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  // Length check first — timingSafeEqual throws on a mismatch rather than
  // returning false, and that throw would read as a server error instead of
  // a rejected request.
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

interface LemonSqueezyWebhook {
  meta?: {
    event_name?: string;
    custom_data?: { user_id?: string; plan?: string; billing?: string };
  };
  data?: {
    attributes?: {
      status?: string;
      variant_id?: number | string;
      user_email?: string;
      renews_at?: string | null;
      ends_at?: string | null;
      first_order_item?: { variant_id?: number | string };
    };
    id?: string;
  };
}

export interface WebhookOutcome {
  handled: boolean;
  event: string;
  note: string;
}

/**
 * Process a verified webhook. Idempotent — Lemon Squeezy retries on any
 * non-2xx, so the same event arriving twice must not double-apply.
 */
export async function handleWebhook(db: DbHandle, rawBody: string): Promise<WebhookOutcome> {
  const payload = JSON.parse(rawBody) as LemonSqueezyWebhook;
  const event = payload.meta?.event_name ?? "unknown";
  const custom = payload.meta?.custom_data ?? {};
  const attrs = payload.data?.attributes ?? {};

  const userId = custom.user_id;
  if (!userId) {
    // No custom data means we cannot attribute this to an account. Report it
    // rather than guessing by email, which silently attaches a payment to the
    // wrong person when someone pays from a different address.
    return { handled: false, event, note: "no user_id in custom_data; cannot attribute" };
  }

  switch (event) {
    case "order_created":
    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
    case "subscription_payment_success": {
      const variantId = String(
        attrs.variant_id ?? attrs.first_order_item?.variant_id ?? ""
      );
      // Trust the variant over custom_data for what was actually bought: the
      // customer can change plan on the Lemon Squeezy checkout page after we
      // built the URL, and the variant is what they were charged for.
      const resolved = planForVariant(variantId);
      const plan = (resolved?.plan ?? (custom.plan as PlanId | undefined) ?? "solo") as PlanId;
      const billing = (resolved?.billing ??
        (custom.billing as BillingCycle | undefined) ??
        "monthly") as BillingCycle;

      const status = attrs.status ?? "active";
      if (status === "cancelled" || status === "expired" || status === "unpaid") {
        lockSubscription(db, userId);
        return { handled: true, event, note: `status=${status} → locked` };
      }

      // Prefer Lemon Squeezy's own renewal date over our computed duration —
      // it is the authority on when this subscription actually lapses.
      const renewsAt = attrs.renews_at ? Date.parse(attrs.renews_at) : NaN;
      const durationMs = subscriptionDurationMs(billing);
      const expiresAt = Number.isFinite(renewsAt) ? renewsAt : Date.now() + durationMs;

      activateSubscription(db, {
        userId,
        plan,
        billing,
        expiresAt,
        lemonSqueezySubscriptionId: payload.data?.id ?? null,
      });
      return { handled: true, event, note: `activated ${plan}/${billing}` };
    }

    case "subscription_cancelled":
    case "subscription_expired":
    case "subscription_paused": {
      lockSubscription(db, userId);
      return { handled: true, event, note: "locked" };
    }

    default:
      return { handled: false, event, note: "event ignored" };
  }
}

/**
 * Confirm a license key with Lemon Squeezy.
 *
 * Used once, at activation. Everything after that reads our mirrored copy —
 * see the module comment on why we do not call out on every check.
 */
export async function validateWithLemonSqueezy(
  licenseKey: string
): Promise<{ valid: boolean; email?: string; note: string }> {
  if (DEV_MODE) return { valid: true, note: "dev mode: not checked" };

  const res = await fetch(`${LS_API}/licenses/validate`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ license_key: licenseKey }),
  });
  if (!res.ok) return { valid: false, note: `Lemon Squeezy returned ${res.status}` };
  const body = (await res.json()) as {
    valid?: boolean;
    meta?: { customer_email?: string };
    error?: string;
  };
  return {
    valid: !!body.valid,
    email: body.meta?.customer_email,
    note: body.error ?? (body.valid ? "valid" : "not valid"),
  };
}

// ── Subscription state ──────────────────────────────────────────────────────

export interface ActivateInput {
  userId: string;
  plan: PlanId;
  billing: BillingCycle;
  expiresAt: number;
  lemonSqueezySubscriptionId?: string | null;
  /** The key Lemon Squeezy issued, mirrored locally. */
  licenseKey?: string | null;
  /**
   * 1 = renewing (paid plans, Lemon Squeezy webhooks). 0 = fixed-duration
   * (trials): the row then qualifies for lockIfExpired, so an expired trial
   * is locked by the same 60s timer as a lapsed paid subscription. Defaults
   * to 1 because every existing caller is a paid path.
   */
  autoRenew?: number;
}

export function activateSubscription(db: DbHandle, input: ActivateInput): SubscriptionRow {
  const now = Date.now();
  // Trials must be autoRenew = 0 or lockIfExpired (which only touches
  // auto_renew = 0 rows) will never lock them and they'd live forever.
  const autoRenew = input.autoRenew ?? 1;
  const existing = db.raw
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(input.userId) as unknown as SubscriptionRow | undefined;

  if (existing) {
    db.raw
      .prepare(
        `UPDATE subscriptions
         SET plan = ?, billing = ?, status = 'active',
             ls_subscription_id = ?,
             license_key = COALESCE(?, license_key),
             started_at = ?, expires_at = ?, auto_renew = ?, locked_at = NULL
         WHERE id = ?`
      )
      .run(
        input.plan,
        input.billing,
        input.lemonSqueezySubscriptionId ?? null,
        input.licenseKey ?? null,
        existing.started_at || now,
        input.expiresAt,
        autoRenew,
        existing.id
      );
    return db.raw
      .prepare("SELECT * FROM subscriptions WHERE id = ?")
      .get(existing.id) as unknown as SubscriptionRow;
  }

  const subId = randomUUID();
  db.raw
    .prepare(
      `INSERT INTO subscriptions
         (id, user_id, plan, billing, status, ls_subscription_id, license_key,
          started_at, expires_at, auto_renew, locked_at, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      subId,
      input.userId,
      input.plan,
      input.billing,
      input.lemonSqueezySubscriptionId ?? null,
      input.licenseKey ?? null,
      now,
      input.expiresAt,
      autoRenew,
      now
    );
  return db.raw
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .get(subId) as unknown as SubscriptionRow;
}

export function lockSubscription(db: DbHandle, userId: string): void {
  db.raw
    .prepare("UPDATE subscriptions SET status = 'locked', auto_renew = 0, locked_at = ? WHERE user_id = ?")
    .run(Date.now(), userId);
}

export function getSubscription(db: DbHandle, userId: string): SubscriptionRow | null {
  return (
    (db.raw
      .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
      .get(userId) as unknown as SubscriptionRow | undefined) ?? null
  );
}

/** Look a subscription up by the license key the customer pastes in. */
export function getSubscriptionByLicenseKey(db: DbHandle, licenseKey: string): SubscriptionRow | null {
  return (
    (db.raw
      .prepare("SELECT * FROM subscriptions WHERE license_key = ?")
      .get(licenseKey) as unknown as SubscriptionRow | undefined) ?? null
  );
}

export function setAutoRenew(db: DbHandle, userId: string, enabled: boolean): void {
  db.raw.prepare("UPDATE subscriptions SET auto_renew = ? WHERE user_id = ?").run(enabled ? 1 : 0, userId);
}

/** Attach a license key to an existing subscription. Idempotent. */
export function attachLicenseKey(db: DbHandle, userId: string, licenseKey: string): void {
  db.raw.prepare("UPDATE subscriptions SET license_key = ? WHERE user_id = ?").run(licenseKey, userId);
}

/** Lock subscriptions whose expiry has passed and auto-renew is off. Idempotent. */
export function lockIfExpired(db: DbHandle): number {
  const now = Date.now();
  const result = db.raw
    .prepare(
      `UPDATE subscriptions
       SET status = 'locked', locked_at = ?
       WHERE status = 'active' AND expires_at < ? AND auto_renew = 0`
    )
    .run(now, now);
  return Number(result.changes);
}

/**
 * Grant extra connections bought on their own.
 *
 * Additive rather than absolute: buying a second add-on must give a sixth and
 * seventh connection, not reset the count to one. `quantity` comes from the
 * Lemon Squeezy order, so buying three at once in a single checkout works
 * without three separate webhooks.
 */
export function addAddonConnections(db: DbHandle, userId: string, quantity: number): number {
  const n = Math.max(0, Math.floor(quantity));
  if (n === 0) return 0;
  db.raw
    .prepare("UPDATE subscriptions SET addon_connections = addon_connections + ? WHERE user_id = ?")
    .run(n, userId);
  const row = db.raw
    .prepare("SELECT addon_connections FROM subscriptions WHERE user_id = ?")
    .get(userId) as unknown as { addon_connections: number } | undefined;
  return row?.addon_connections ?? 0;
}

/**
 * Remove add-on connections when one is cancelled.
 *
 * Floors at zero. Existing installs over the new limit are deliberately NOT
 * force-removed here: silently killing a machine's access because a
 * subscription changed is the kind of surprise that costs trust. The limit
 * simply stops new registrations until they are back under it, and the
 * dashboard shows them which to remove.
 */
export function removeAddonConnections(db: DbHandle, userId: string, quantity: number): number {
  const n = Math.max(0, Math.floor(quantity));
  if (n === 0) return 0;
  db.raw
    .prepare(
      "UPDATE subscriptions SET addon_connections = MAX(0, addon_connections - ?) WHERE user_id = ?"
    )
    .run(n, userId);
  const row = db.raw
    .prepare("SELECT addon_connections FROM subscriptions WHERE user_id = ?")
    .get(userId) as unknown as { addon_connections: number } | undefined;
  return row?.addon_connections ?? 0;
}
