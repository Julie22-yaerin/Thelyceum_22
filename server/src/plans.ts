/**
 * Plan definitions.
 *
 * ── Why these numbers, not the old $222 / $310 ──────────────────────────────
 * The core CLI is MIT-licensed and nothing in it checks for a license before
 * running — `brake scan` and `brake engage` work today, free, forever, for
 * anyone who clones the repo. That is not a bug to route around; it is the
 * license, and pricing has to be honest about what payment actually buys on
 * top of it: tracked multi-device install limits (real, enforced server-side
 * in devices.ts), the guided setup flow (see guides.ts), and priority
 * support. It does not buy the danger detection itself.
 *
 * Priced for the buyer this product actually has: a solo operator or small
 * team paying out of pocket, self-serve, no procurement. $222/mo asked for
 * enterprise-procurement trust signals this product does not have yet — a
 * sales-assisted enterprise motion for a tool with no sales team reads as a
 * mistake, not confidence. The number one incident costs (a runaway agent's
 * API bill) still dwarfs a $9–29/mo subscription, which is the argument that
 * actually needs to survive contact with the buyer's own wallet.
 *
 * The prices here are the source of truth. Stripe is configured with
 * `price_data` computed from these at checkout time (see `stripe.ts`) — no
 * hardcoded Stripe price IDs to keep in sync.
 *
 * Annual billing is presented as a per-month figure but charged as the
 * annual total up-front. The discount is the difference between the annual
 * monthly-rate and the monthly monthly-rate.
 */

export type PlanId = "starter" | "pro";
export type BillingCycle = "monthly" | "annual";
export type SubscriptionStatus = "active" | "locked";

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Max number of AI host connections (each install on each device = 1). */
  aiConnections: number;
  /** Per-month price in cents. Annual is also charged per-month equivalent. */
  pricesCentsPerMonth: Record<BillingCycle, number>;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "For a solo operator running a couple of agents. The core detection is free either way — this is for tracked devices and the guided setup.",
    aiConnections: 3,
    pricesCentsPerMonth: {
      monthly: 900,  // $9.00 / month
      annual: 700,   // $7.00 / month, billed annually as $84.00
    },
    features: [
      "Up to 3 tracked AI host connections (Claude Desktop, Claude Code, ChatGPT)",
      "Guided, step-by-step setup — unlocked docs with copy-paste commands",
      "Everything in the free CLI: danger_scan, 1000ms SLA, local audit log",
      "Standard email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For a small team running agents across several machines.",
    aiConnections: 10,
    pricesCentsPerMonth: {
      monthly: 2900,  // $29.00 / month
      annual: 2400,   // $24.00 / month, billed annually as $288.00
    },
    features: [
      "Up to 10 tracked AI host connections",
      "Everything in Starter",
      "Priority email support, < 1 business day",
      "First access to new danger rules and new Lyceum tools",
    ],
  },
];

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** Price for a single billing period in cents, suitable for Stripe. */
export function priceFor(plan: PlanId, cycle: BillingCycle): number {
  const p = getPlan(plan);
  if (cycle === "monthly") return p.pricesCentsPerMonth.monthly;
  // Annual: charge the monthly equivalent × 12 up-front.
  return p.pricesCentsPerMonth.annual * 12;
}

/** Annual discount vs paying monthly for a year, as a fraction. */
export function annualDiscountFraction(plan: PlanId): number {
  const p = getPlan(plan);
  const monthlyYear = p.pricesCentsPerMonth.monthly * 12;
  const annual = p.pricesCentsPerMonth.annual * 12;
  return 1 - annual / monthlyYear;
}

/** Subscription expiry duration, in milliseconds. */
export function subscriptionDurationMs(cycle: BillingCycle): number {
  return cycle === "monthly"
    ? 30 * 24 * 60 * 60 * 1000
    : 365 * 24 * 60 * 60 * 1000;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
