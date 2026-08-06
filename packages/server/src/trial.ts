/**
 * The 30-day pre-release trial (see TRIAL_PLAN.md).
 *
 * ── What a trial is ─────────────────────────────────────────────────────────
 * A real subscription row, 30 days, auto-renew off, license key prefixed
 * LYCEUM-TRIAL-. Everything downstream already understands it: the same
 * activateSubscription path writes it, the same connectionLimitFor caps it,
 * the same 60-second lockIfExpired timer locks it on day 30, and the CLI's
 * `brake login` flow reads it through the same /api/license endpoint. The
 * trial is the full product, not a demo — a trial company on 5 connections
 * hits the same 402 as a paying one.
 *
 * ── The token ──────────────────────────────────────────────────────────────
 * A signed JWT, bound to the cohort email and minted only for waitlist
 * applications that are paid or approved (the deposit is the cohort filter).
 * Redeeming requires the token's email to match the session email — one
 * token, one account — and one trial per account, ever: activation writes a
 * LYCEUM-TRIAL- key, and any account that already holds one is refused.
 *
 * ── Why a token and not a discount code ────────────────────────────────────
 * The token carries the plan and the email, so minting is a deliberate admin
 * act recorded in the audit log, and redemption cannot be pasted into a
 * different account than the one the cohort application named.
 */

import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { DbHandle } from "./db.js";
import { getPlan, isPlanId, type PlanId } from "./plans.js";
import { activateSubscription, getSubscription } from "./lemonsqueezy.js";
import { getByEmail } from "./waitlist.js";
import { recordAdminAction, type AdminIdentity } from "./admin.js";

export const TRIAL_DURATION_MS = 2 * 24 * 60 * 60 * 1000;
/** The trial's license key is deliberately recognisable, like LYCEUM-DEV-. */
export const TRIAL_LICENSE_PREFIX = "LYCEUM-TRIAL-";
/** Every key Lyceum itself mints shares this prefix — trial and dev keys. */
export const LYCEUM_KEY_PREFIX = "LYCEUM-";

/**
 * True when a key was minted by Lyceum itself, never by Lemon Squeezy.
 *
 * Trial keys (LYCEUM-TRIAL-…) and dev keys (LYCEUM-DEV-…) are issued by us;
 * they exist only in OUR mirror (the subscriptions table), never in Lemon
 * Squeezy. So in non-dev mode there is no point asking Lemon Squeezy about
 * one — it cannot validate a key it never issued, and the honest answer is
 * "this key isn't registered on this instance", not "invalid key".
 */
export function isLyceumIssuedKey(key: string): boolean {
  // Case-insensitive on purpose: a customer pasting a trial key in lowercase
  // must still get the honest "not mirrored here" answer, not the misleading
  // "invalid key" this guard exists to prevent. No real Lemon Squeezy key
  // starts with LYCEUM- in any case, so this cannot false-positive.
  return key.toUpperCase().startsWith(LYCEUM_KEY_PREFIX);
}
/** A minted token must be redeemed within this window; afterwards it expires. */
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export class TrialError extends Error {
  constructor(
    public code:
      | "not_in_cohort"
      | "invalid_input"
      | "invalid_token"
      | "email_mismatch"
      | "already_used"
      | "has_subscription",
    message: string
  ) {
    super(message);
    this.name = "TrialError";
  }
}

interface TrialTokenPayload {
  purpose: "trial";
  email: string;
  plan: PlanId;
  iat: number;
  exp: number;
}

// ── Mint (admin) ────────────────────────────────────────────────────────────

export interface MintTrialInput {
  email: string;
  plan?: PlanId;
}

export interface MintTrialResult {
  token: string;
  email: string;
  plan: PlanId;
  expiresInMs: number;
}

/**
 * Mint a trial token for a cohort member.
 *
 * Cohort gate: the email must be a waitlist application with status paid or
 * approved. Pending means the deposit hasn't cleared; rejected is a no. This
 * is the same status the admin console already manages — no new state.
 */
export function mintTrialToken(
  db: DbHandle,
  secret: string,
  identity: AdminIdentity,
  input: MintTrialInput
): MintTrialResult {
  const email = input.email.trim().toLowerCase();
  const plan = input.plan ?? "solo";
  if (!isPlanId(plan)) throw new TrialError("invalid_input", `Unknown plan: ${plan}`);

  const application = getByEmail(db, email);
  if (!application || (application.status !== "paid" && application.status !== "approved")) {
    throw new TrialError(
      "not_in_cohort",
      "Only paid or approved waitlist applications can be issued a trial."
    );
  }

  const token = jwt.sign(
    { purpose: "trial", email, plan },
    secret,
    { expiresIn: TOKEN_TTL_SECONDS }
  ) as string;

  recordAdminAction(db, identity, "trial.mint", { email, plan, waitlist_id: application.id });

  return { token, email, plan, expiresInMs: TOKEN_TTL_SECONDS * 1000 };
}

// ── Activate (cohort member) ────────────────────────────────────────────────

export interface ActivateTrialInput {
  userId: string;
  /** The session email — must match the token's email. */
  email: string;
  token: string;
}

export interface ActivateTrialResult {
  plan: PlanId;
  billing: "monthly";
  expiresAt: number;
  licenseKey: string;
  connectionLimit: number;
}

export function activateTrial(
  db: DbHandle,
  secret: string,
  input: ActivateTrialInput
): ActivateTrialResult {
  let payload: TrialTokenPayload;
  try {
    const decoded = jwt.verify(input.token, secret) as Partial<TrialTokenPayload>;
    if (decoded.purpose !== "trial" || !decoded.email || !isPlanId(decoded.plan)) {
      throw new Error("bad token shape");
    }
    payload = decoded as TrialTokenPayload;
  } catch {
    throw new TrialError("invalid_token", "That trial token isn't valid or has expired.");
  }

  const email = input.email.trim().toLowerCase();
  if (payload.email !== email) {
    throw new TrialError(
      "email_mismatch",
      "This trial token was issued to a different email. Sign in with the account that applied."
    );
  }

  const existing = getSubscription(db, input.userId);

  // One trial per account, ever. A trial key already on the account — even a
  // locked one — means the trial was used. This also makes a token single-use:
  // the first redemption writes the key, any later one is refused.
  if (existing?.license_key?.startsWith(TRIAL_LICENSE_PREFIX)) {
    throw new TrialError("already_used", "This account has already used its trial.");
  }

  // Never let a trial clobber a real subscription. activateSubscription's
  // UPDATE path rewrites plan/billing/expiry/license_key in place, so an
  // account that bought something must not be silently downgraded to a trial
  // by pasting a token. The guard is on the ROW, not the license key: a paid
  // subscription created via webhook has license_key = NULL until the
  // customer pastes their key, and that row must still block a trial.
  if (existing) {
    throw new TrialError(
      "has_subscription",
      "This account already has a subscription. A trial is for accounts with none."
    );
  }

  const plan = payload.plan;
  const expiresAt = Date.now() + TRIAL_DURATION_MS;
  const licenseKey = `${TRIAL_LICENSE_PREFIX}${randomUUID()}`;
  activateSubscription(db, {
    userId: input.userId,
    plan,
    billing: "monthly",
    expiresAt,
    licenseKey,
    autoRenew: 0,
  });

  return {
    plan,
    billing: "monthly",
    expiresAt,
    licenseKey,
    connectionLimit: getPlan(plan).aiConnections,
  };
}
