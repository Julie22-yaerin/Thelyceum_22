/**
 * Plan definitions.
 *
 * ── Repriced again: $9/$29 was aimed at the wrong buyer ─────────────────────
 * The previous version of this file argued the buyer was a solo operator
 * paying out of pocket, and priced for that. The actual buyer is a company
 * with a large, ongoing AI operating cost across a fleet of agents — and for
 * that buyer, a card that reads $9/mo does not read as "cheap and honest," it
 * reads as "not built for what I run." A team burning tens of thousands of
 * dollars a month on inference does not evaluate a safety layer on whether it
 * is a rounding error; they evaluate whether it is going to hold up, and the
 * price is one of the signals they read that from before they've tried it.
 *
 * What stays true from the last version and does not change with the buyer:
 * the CORE DETECTION IS STILL FREE. brake's danger_scan and redteam's
 * challenge are still MIT, still run with no license check, still work for
 * anyone who clones the repo. Pricing here is honest about that in the same
 * way it was at $9/mo — it is not selling detection, it is selling the
 * managed layer on top: tracked fleet-wide install limits, the guided setup,
 * support with a real response-time commitment, and — at Enterprise — a
 * contract instead of a credit card. Both products are covered by one
 * subscription; there is one Lyceum plan, not two separate purchases.
 *
 * Enterprise is deliberately NOT a self-serve checkout tier. A company large
 * enough to need this needs a person to talk to about procurement, DPAs, and
 * fleet size that doesn't fit a fixed connection count — putting a number on
 * a button for that buyer is either a lowball that leaves money on the table
 * or a guess that's wrong for their actual scale. `ENTERPRISE_TIER` is a
 * separate constant for exactly that reason: it never goes through
 * `priceFor`/Stripe, only through a contact link.
 */

export type PlanId = "team" | "business";
export type BillingCycle = "monthly" | "annual";
export type SubscriptionStatus = "active" | "locked";

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Max number of AI host connections (each install on each device = 1), across both products. */
  aiConnections: number;
  /** Per-month price in cents. Annual is also charged per-month equivalent. */
  pricesCentsPerMonth: Record<BillingCycle, number>;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "team",
    name: "Team",
    description: "For a team running agents in production, not just experimenting with them.",
    aiConnections: 15,
    pricesCentsPerMonth: {
      monthly: 19900, // $199.00 / month
      annual: 16600,  // $166.00 / month, billed annually as $1,992.00 (~17% off)
    },
    features: [
      "Both circuit breakers — brake and redteam — one plan",
      "Up to 15 tracked AI host connections",
      "Guided, step-by-step setup for both tools",
      "Standard email support",
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "For a fleet of agents across several teams or environments.",
    aiConnections: 75,
    pricesCentsPerMonth: {
      monthly: 79900, // $799.00 / month
      annual: 66600,  // $666.00 / month, billed annually as $7,992.00 (~17% off)
    },
    features: [
      "Everything in Team",
      "Up to 75 tracked AI host connections",
      "Priority support, < 4 business hours",
      "First access to new danger rules, new flaw classes, and new Lyceum tools",
    ],
  },
];

/**
 * Not a Plan, not billed through Stripe. Shown on the pricing page as a
 * contact card, never a checkout button — see the module comment.
 */
export const ENTERPRISE_TIER = {
  name: "Enterprise",
  description:
    "For an AI operation with fleet-wide spend measured in the hundreds of thousands or more, where one runaway agent can cost more than a year of any plan above.",
  features: [
    "Unlimited tracked AI host connections",
    "Dedicated Slack channel with the team that builds this",
    "Custom danger and flaw-class rules for your infrastructure",
    "Procurement-ready: DPA, security questionnaire, invoicing terms",
  ],
  contactEmail: "enterprise@thelyceum.dev",
} as const;

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
