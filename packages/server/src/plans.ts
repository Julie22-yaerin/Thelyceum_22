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
  /**
   * Monthly usage budget in tokens, tracked per user from the CLIs' usage
   * reports (thrift reports real tokens processed; brake/redteam report
   * estimated tokens of the text they scanned). The dashboard shows used vs
   * this, and warns past BUDGET_WARN_PCT. Overridable per plan via
   * LYCEUM_BUDGET_TOKENS_<PLAN> so staging and prod can differ.
   */
  monthlyTokenBudget: number;
  features: string[];
}

/** Warn past this fraction of the monthly token budget. */
export const BUDGET_WARN_PCT = 0.8;

export const PLANS: Plan[] = [
  {
    id: "solo",
    name: "Solo",
    description: "One operator, a laptop and a server. Enough to cover everywhere you actually run agents.",
    aiConnections: 5,
    monthlyTokenBudget: budgetTokensEnv("SOLO", 50_000_000),
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
    monthlyTokenBudget: budgetTokensEnv("TEAM", 250_000_000),
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
    monthlyTokenBudget: budgetTokensEnv("SCALE", 1_000_000_000),
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

/**
 * Monthly token budget for a plan, from env or a default.
 *
 * The defaults are deliberately generous — the budget is a runaway-loop
 * tripwire, not a metering cap. Its job is to make a fleet that is burning
 * 10× what it planned visible on the dashboard, not to throttle a healthy
 * team. Env override: LYCEUM_BUDGET_TOKENS_SOLO / _TEAM / _SCALE.
 */
function budgetTokensEnv(plan: "SOLO" | "TEAM" | "SCALE", fallback: number): number {
  const raw = process.env[`LYCEUM_BUDGET_TOKENS_${plan}`];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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
 * The pre-order price for the CLI suite, paid to join the waitlist.
 *
 * Non-refundable, and said plainly as such everywhere it's shown. It exists
 * to make the list mean something, not to make money — a free waitlist fills
 * with people who will never buy and tells you nothing about demand. Making
 * it non-refundable rather than "refundable but we'll ask why" is the
 * honest version of the same filter: the friction has to be real to do its
 * job, and a friction that evaporates on request isn't friction.
 *
 * This is a number our own code shows in copy and falls back to in the
 * webhook (see index.ts) if Lemon Squeezy's payload omits a total — it is
 * NOT what sets the actual charge. The amount a customer is charged is
 * whatever price is configured on the Lemon Squeezy product page for
 * LEMONSQUEEZY_CHECKOUT_URL (see waitlist.js); the two must be kept in sync
 * by hand on a price change, there is no code path that enforces it.
 */
export const WAITLIST_DEPOSIT_CENTS = 5200;

/**
 * Official launch date for the CLI suite — when pre-order applicants get
 * their setup email. Separate from WAITLIST_DEADLINE_ISO on purpose: the
 * window to pre-order closes first, launch follows a couple of days later.
 */
export const LAUNCH_DATE_ISO = "2026-08-22T00:00:00Z";

export const WAITLIST_VARIANT_ID = process.env.LS_VARIANT_WAITLIST_DEPOSIT;

/**
 * Hard cap on the waitlist.
 *
 * The pitch is "we bring teams on in batches so setup gets a person" — that
 * promise is false past some size, and 60 is where the plan actually holds.
 * Counts every application that isn't rejected, so a rejection genuinely
 * frees the slot rather than the cap silently meaning "60 non-rejected plus
 * however many were rejected", which nobody could reason about from outside.
 */
export const WAITLIST_MAX_APPLICATIONS = 60;

/**
 * Hard close date on the waitlist, independent of the headcount cap —
 * whichever of the two is hit first closes applications. ISO 8601 / UTC so
 * "the deadline" means the same instant on the server, in every browser's
 * countdown, and in this constant — never local server time, which drifts
 * with wherever the process happens to be deployed.
 */
export const WAITLIST_DEADLINE_ISO = "2026-08-20T23:59:59Z";
