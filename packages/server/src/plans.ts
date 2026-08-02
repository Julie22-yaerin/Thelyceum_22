/**
 * Plan definitions.
 *
 * ── Connection counts: 5 / 10 / 15 ──────────────────────────────────────────
 * The previous 15/75 was wrong in a way worth naming: a "connection" here is
 * one install of one tool on one machine, and 75 of those describes a company
 * that is well past self-serve and should be on a contract anyway. Real teams
 * running agents seriously have a handful of machines — a few developer
 * laptops, a CI runner, a couple of servers. 5 / 10 / 15 covers that, and
 * anything past 15 is the conversation Enterprise exists for.
 *
 * ── Where the prices are the source of truth, and where they are not ────────
 * The cents figures below are what the site renders. Lemon Squeezy holds what
 * the customer is actually charged, keyed by variant id. Those two must agree,
 * and nothing here can enforce that — so `assertVariantsConfigured()` at least
 * makes a missing variant a startup error rather than a checkout that 500s
 * after the customer clicked buy.
 *
 * Enterprise is deliberately not a Plan: it never reaches checkout, it is a
 * contact card. A fleet that size needs a conversation about scale and
 * procurement, and a number on a button for that buyer is either a lowball or
 * a wrong guess.
 */

export type PlanId = "solo" | "team" | "scale";
export type BillingCycle = "monthly" | "annual";
export type SubscriptionStatus = "active" | "locked";

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Max installs across both tools; one install on one machine = one. */
  aiConnections: number;
  /** Per-month price in cents. Annual is charged as this × 12 up-front. */
  pricesCentsPerMonth: Record<BillingCycle, number>;
  /** Lemon Squeezy variant ids, from env so staging and prod can differ. */
  lemonSqueezyVariantIds: Record<BillingCycle, string | undefined>;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    id: "solo",
    name: "Solo",
    description: "One operator, a laptop and a server. Enough to cover everywhere you actually run agents.",
    aiConnections: 5,
    pricesCentsPerMonth: {
      monthly: 9900,  // $99
      annual: 8300,   // $83/mo, billed annually as $996
    },
    lemonSqueezyVariantIds: {
      monthly: process.env.LS_VARIANT_SOLO_MONTHLY,
      annual: process.env.LS_VARIANT_SOLO_ANNUAL,
    },
    features: [
      "All three tools — brake, redteam and thrift",
      "5 AI host connections",
      "Guided, step-by-step setup for both tools",
      "Standard email support",
    ],
  },
  {
    id: "team",
    name: "Team",
    description: "A team running agents in production across a few machines and a CI runner.",
    aiConnections: 10,
    pricesCentsPerMonth: {
      monthly: 29900, // $299
      annual: 24900,  // $249/mo, billed annually as $2,988
    },
    lemonSqueezyVariantIds: {
      monthly: process.env.LS_VARIANT_TEAM_MONTHLY,
      annual: process.env.LS_VARIANT_TEAM_ANNUAL,
    },
    features: [
      "Everything in Solo",
      "10 AI host connections",
      "Priority email support, < 1 business day",
      "First access to new danger rules and flaw classes",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    description: "Several teams or environments, where one runaway agent costs more than a year of this.",
    aiConnections: 15,
    pricesCentsPerMonth: {
      monthly: 79900, // $799
      annual: 66600,  // $666/mo, billed annually as $7,992
    },
    lemonSqueezyVariantIds: {
      monthly: process.env.LS_VARIANT_SCALE_MONTHLY,
      annual: process.env.LS_VARIANT_SCALE_ANNUAL,
    },
    features: [
      "Everything in Team",
      "15 AI host connections",
      "Priority support, < 4 business hours",
      "Custom danger rules reviewed with you",
    ],
  },
];

export const ENTERPRISE_TIER = {
  name: "Enterprise",
  description:
    "Past 15 connections, or you need procurement, a DPA and invoicing terms. Priced against your fleet, not a tier.",
  features: [
    "Unlimited connections",
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

export function isPlanId(v: unknown): v is PlanId {
  return v === "solo" || v === "team" || v === "scale";
}

/**
 * Reverse-map a Lemon Squeezy variant to a plan.
 *
 * The webhook trusts this over the custom_data we sent, because the customer
 * can switch plan on the Lemon Squeezy page after our checkout URL was built —
 * the variant is what they were actually charged for.
 */
export function planForVariant(
  variantId: string
): { plan: PlanId; billing: BillingCycle } | null {
  if (!variantId) return null;
  for (const p of PLANS) {
    for (const cycle of ["monthly", "annual"] as BillingCycle[]) {
      if (p.lemonSqueezyVariantIds[cycle] && p.lemonSqueezyVariantIds[cycle] === variantId) {
        return { plan: p.id, billing: cycle };
      }
    }
  }
  return null;
}

/**
 * Fail at boot rather than at checkout when a variant is missing.
 *
 * A customer clicking "buy" and getting a 500 is a lost sale we never hear
 * about; a server that refuses to start is a problem we fix before anyone
 * sees it. Skipped in dev mode, where checkout is bypassed anyway.
 */
export function assertVariantsConfigured(devMode: boolean): string[] {
  if (devMode) return [];
  const missing: string[] = [];
  for (const p of PLANS) {
    for (const cycle of ["monthly", "annual"] as BillingCycle[]) {
      if (!p.lemonSqueezyVariantIds[cycle]) {
        missing.push(`LS_VARIANT_${p.id.toUpperCase()}_${cycle.toUpperCase()}`);
      }
    }
  }
  return missing;
}

/** Price for a single billing period in cents. */
export function priceFor(plan: PlanId, cycle: BillingCycle): number {
  const p = getPlan(plan);
  if (cycle === "monthly") return p.pricesCentsPerMonth.monthly;
  return p.pricesCentsPerMonth.annual * 12;
}

export function annualDiscountFraction(plan: PlanId): number {
  const p = getPlan(plan);
  const monthlyYear = p.pricesCentsPerMonth.monthly * 12;
  const annual = p.pricesCentsPerMonth.annual * 12;
  return 1 - annual / monthlyYear;
}

export function subscriptionDurationMs(cycle: BillingCycle): number {
  return cycle === "monthly" ? 30 * 24 * 60 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Add-on connections ──────────────────────────────────────────────────────

/**
 * One extra connection, bought on its own.
 *
 * $100/month buys one more machine on top of the plan's allowance. Priced
 * against the tiers rather than under them on purpose: Solo is $99 for five
 * connections, so a single add-on is deliberately poor value compared with
 * moving up a tier. That is the intent — add-ons are for the team that is on
 * Scale and needs a sixteenth machine, not a cheaper route to Team.
 *
 * Add-ons are stored separately from the plan (see `addon_connections` in
 * db.ts) so changing plan never silently discards connections already paid
 * for.
 */
export const ADDON_CONNECTION_CENTS_PER_MONTH = 10000;

export const ADDON_CONNECTION_VARIANT_ID = process.env.LS_VARIANT_ADDON_CONNECTION;

/** Total connections available: the plan's allowance plus anything bought on top. */
export function connectionLimitFor(plan: PlanId, addonConnections: number): number {
  return getPlan(plan).aiConnections + Math.max(0, addonConnections);
}

// ── Waitlist ────────────────────────────────────────────────────────────────

/**
 * The deposit to join the waitlist.
 *
 * It is refundable and it credits against the first invoice — it exists to
 * make the list mean something, not to make money. A free waitlist fills with
 * people who will never buy and tells you nothing about demand; $10 of
 * friction filters to people who actually intend to.
 */
export const WAITLIST_DEPOSIT_CENTS = 1000;

export const WAITLIST_VARIANT_ID = process.env.LS_VARIANT_WAITLIST_DEPOSIT;
