/**
 * Stripe wrapper.
 *
 * The license server does not call Stripe directly from route handlers;
 * it goes through this module so the same Stripe object is reused and the
 * shape of the call is consistent. The two entry points are:
 *
 *   createCheckoutSession  — called by the web app when the user picks a plan
 *   handleWebhookEvent     — called by /api/stripe/webhook
 *
 * In `BRAKE_DEV_MODE=1`, Stripe is bypassed entirely: createCheckoutSession
 * returns a local URL that flips the subscription to active immediately.
 * Use this for local development and CI; never in production.
 */

import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import type { DbHandle, SubscriptionRow } from "./db.js";
import { getPlan, priceFor, subscriptionDurationMs, type BillingCycle, type PlanId } from "./plans.js";

const DEV_MODE = process.env.BRAKE_DEV_MODE === "1";

let stripe: Stripe | null = null;
function client(): Stripe {
  if (DEV_MODE) throw new Error("Stripe is disabled in BRAKE_DEV_MODE");
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion });
  return stripe;
}

export interface CreateCheckoutInput {
  userId: string;
  email: string;
  plan: PlanId;
  billing: BillingCycle;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutResult {
  url: string;
  sessionId: string;
  /** Present in dev mode; the web can redirect to this and the sub is auto-activated. */
  devMode: boolean;
}

export async function createCheckoutSession(db: DbHandle, input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  const plan = getPlan(input.plan);
  const amountCents = priceFor(input.plan, input.billing);
  const durationMs = subscriptionDurationMs(input.billing);
  const productName = `brake — ${plan.name} (${input.billing})`;

  if (DEV_MODE) {
    // Synthesize a session id. The web UI redirects here and we activate the
    // subscription directly, no payment needed.
    const sessionId = `dev_${randomUUID()}`;
    return { url: `/dev/activate?session_id=${sessionId}&plan=${input.plan}&billing=${input.billing}&user_id=${input.userId}&duration_ms=${durationMs}&amount=${amountCents}`, sessionId, devMode: true };
  }

  const s = client();
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer_email: input.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: productName, description: plan.description },
          unit_amount: amountCents,
          recurring: { interval: input.billing === "monthly" ? "month" : "year" },
        },
        quantity: 1,
      },
    ],
    metadata: { userId: input.userId, plan: input.plan, billing: input.billing, durationMs: String(durationMs) },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  return { url: session.url ?? "", sessionId: session.id, devMode: false };
}

/**
 * Handle a Stripe webhook event. The function is idempotent — re-delivering
 * the same event is fine; we check the subscription state before mutating.
 */
export async function handleWebhookEvent(db: DbHandle, rawBody: string, signature: string | undefined): Promise<void> {
  if (DEV_MODE) return; // no-op in dev

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const s = client();
  const event = s.webhooks.constructEvent(rawBody, signature ?? "", secret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan as PlanId | undefined;
      const billing = session.metadata?.billing as BillingCycle | undefined;
      const durationMs = Number(session.metadata?.durationMs ?? subscriptionDurationMs("monthly"));
      if (!userId || !plan || !billing) return;
      activateSubscription(db, {
        userId,
        plan,
        billing,
        durationMs,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
        stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
      });
      return;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
      if (!subId) return;
      const sub = db.raw
        .prepare("SELECT * FROM subscriptions WHERE stripe_subscription_id = ?")
        .get(subId) as unknown as SubscriptionRow | undefined;
      if (!sub) return;
      const billing = sub.billing;
      const newExpiry = Date.now() + subscriptionDurationMs(billing);
      db.raw
        .prepare("UPDATE subscriptions SET status = ?, expires_at = ?, auto_renew = 1, locked_at = NULL WHERE id = ?")
        .run("active", newExpiry, sub.id);
      return;
    }
    case "customer.subscription.deleted":
    case "customer.subscription.paused": {
      const sub = event.data.object as Stripe.Subscription;
      const stripeSubId = sub.id;
      db.raw
        .prepare("UPDATE subscriptions SET status = ?, auto_renew = 0, locked_at = ? WHERE stripe_subscription_id = ?")
        .run("locked", Date.now(), stripeSubId);
      return;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const cancelAt = sub.cancel_at;
      if (cancelAt && cancelAt * 1000 > Date.now()) {
        // User cancelled but still has access until period end.
        db.raw
          .prepare("UPDATE subscriptions SET auto_renew = 0 WHERE stripe_subscription_id = ?")
          .run(sub.id);
      }
      return;
    }
  }
}

export interface ActivateInput {
  userId: string;
  plan: PlanId;
  billing: BillingCycle;
  durationMs: number;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

/** Create or replace the user's subscription. Used by the dev flow and by the webhook. */
export function activateSubscription(db: DbHandle, input: ActivateInput): SubscriptionRow {
  const now = Date.now();
  const expiresAt = now + input.durationMs;
  const subId = randomUUID();
  const existing = db.raw
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(input.userId) as SubscriptionRow | undefined;
  if (existing) {
    db.raw
      .prepare(
        `UPDATE subscriptions
         SET plan = ?, billing = ?, status = 'active',
             stripe_customer_id = ?, stripe_subscription_id = ?,
             started_at = ?, expires_at = ?, auto_renew = 1, locked_at = NULL
         WHERE id = ?`
      )
      .run(
        input.plan,
        input.billing,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        now,
        expiresAt,
        existing.id
      );
    return db.raw.prepare("SELECT * FROM subscriptions WHERE id = ?").get(existing.id) as unknown as SubscriptionRow;
  }
  db.raw
    .prepare(
      `INSERT INTO subscriptions
         (id, user_id, plan, billing, status, stripe_customer_id, stripe_subscription_id, started_at, expires_at, auto_renew, locked_at, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 1, NULL, ?)`
    )
    .run(
      subId,
      input.userId,
      input.plan,
      input.billing,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      now,
      expiresAt,
      now
    );
  return db.raw.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subId) as unknown as SubscriptionRow;
}

export function getSubscription(db: DbHandle, userId: string): SubscriptionRow | null {
  return (
    (db.raw.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as unknown as SubscriptionRow | undefined) ??
    null
  );
}

export function setAutoRenew(db: DbHandle, userId: string, enabled: boolean): void {
  db.raw.prepare("UPDATE subscriptions SET auto_renew = ? WHERE user_id = ?").run(enabled ? 1 : 0, userId);
}

/** Lock a subscription whose expiry has passed and auto-renew is off. Idempotent. */
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
