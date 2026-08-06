/**
 * Standalone beta trial licenses — for handing a zip directly to a named
 * external recipient (no waitlist account, no sign-in). Separate from
 * trial.ts on purpose: that system gates a cohort behind a paid/approved
 * waitlist application and a signed-in account; this one is "mint one key,
 * email it, done" for a single evaluator.
 *
 * ── Enforcement model ────────────────────────────────────────────────────
 * The key is a signed JWT (`purpose: "beta"`, embeds licenseId + label),
 * verified with the same secret as every other Lyceum-issued token. Expiry
 * and the daily-use cap are enforced against the DB row, not the token
 * alone, so a mint can be revoked mid-trial and a day's count survives a
 * server restart. /api/beta/check is the only thing that increments usage —
 * it is meant to be called once per real tool invocation (scan / challenge /
 * compress), not on every status check.
 */

import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { DbHandle } from "./db.js";
import { recordAdminAction, type AdminIdentity } from "./admin.js";

export const BETA_LICENSE_PREFIX = "LYCEUM-BETA-";

export class BetaError extends Error {
  constructor(
    public code: "invalid_input" | "invalid_token" | "expired" | "revoked" | "limit_reached",
    message: string
  ) {
    super(message);
    this.name = "BetaError";
  }
}

interface BetaTokenPayload {
  purpose: "beta";
  licenseId: string;
}

// ── Mint (admin) ─────────────────────────────────────────────────────────

export interface MintBetaInput {
  label: string;
  /** Defaults to a 1-week evaluation window. */
  days?: number;
  /** Defaults to 10 real tool calls per UTC day. */
  dailyLimit?: number;
}

export interface MintBetaResult {
  licenseKey: string;
  licenseId: string;
  label: string;
  dailyLimit: number;
  expiresAt: number;
}

export function mintBetaLicense(
  db: DbHandle,
  secret: string,
  identity: AdminIdentity,
  input: MintBetaInput
): MintBetaResult {
  const label = input.label.trim();
  if (!label) throw new BetaError("invalid_input", "A label is required (who is this trial for?).");
  const days = input.days ?? 7;
  const dailyLimit = input.dailyLimit ?? 10;
  if (!(days > 0) || !(dailyLimit > 0)) {
    throw new BetaError("invalid_input", "days and dailyLimit must both be positive.");
  }

  const licenseId = `beta_${randomUUID()}`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + days * 24 * 60 * 60 * 1000;

  db.raw
    .prepare(
      `INSERT INTO beta_licenses (id, label, daily_limit, issued_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`
    )
    .run(licenseId, label, dailyLimit, issuedAt, expiresAt);

  // No JWT `exp` claim: expiry is enforced from the DB row (expires_at),
  // which — unlike a baked-in JWT exp — can be extended or revoked after
  // the key has already been handed out.
  const licenseKey = `${BETA_LICENSE_PREFIX}${jwt.sign({ purpose: "beta", licenseId } satisfies BetaTokenPayload, secret)}`;

  recordAdminAction(db, identity, "beta.mint", { licenseId, label, days, dailyLimit });

  return { licenseKey, licenseId, label, dailyLimit, expiresAt };
}

// ── Check + consume (the CLI, on every real tool call) ──────────────────

export interface BetaCheckResult {
  ok: true;
  usesRemainingToday: number;
  daysRemaining: number;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
}

export function checkBetaUsage(db: DbHandle, secret: string, licenseKey: string): BetaCheckResult {
  const raw = licenseKey.startsWith(BETA_LICENSE_PREFIX)
    ? licenseKey.slice(BETA_LICENSE_PREFIX.length)
    : licenseKey;

  let payload: BetaTokenPayload;
  try {
    const decoded = jwt.verify(raw, secret) as Partial<BetaTokenPayload>;
    if (decoded.purpose !== "beta" || !decoded.licenseId) throw new Error("bad token shape");
    payload = decoded as BetaTokenPayload;
  } catch {
    throw new BetaError("invalid_token", "That beta license key isn't valid.");
  }

  const license = db.raw
    .prepare("SELECT * FROM beta_licenses WHERE id = ?")
    .get(payload.licenseId) as
    | { id: string; label: string; daily_limit: number; issued_at: number; expires_at: number; revoked_at: number | null }
    | undefined;
  if (!license) throw new BetaError("invalid_token", "That beta license key isn't valid.");
  if (license.revoked_at) throw new BetaError("revoked", "This beta license has been revoked.");

  const now = Date.now();
  if (now >= license.expires_at) {
    throw new BetaError("expired", `This beta trial expired on ${new Date(license.expires_at).toISOString().slice(0, 10)}.`);
  }

  const day = utcDay(now);

  // Atomic upsert-and-check inside a transaction: two concurrent calls on
  // the same license must not both read count=9 and both proceed past a
  // limit of 10.
  const result = db.tx(() => {
    db.raw
      .prepare(
        `INSERT INTO beta_usage (license_id, day, count) VALUES (?, ?, 0)
         ON CONFLICT (license_id, day) DO NOTHING`
      )
      .run(license.id, day);

    const row = db.raw
      .prepare("SELECT count FROM beta_usage WHERE license_id = ? AND day = ?")
      .get(license.id, day) as { count: number };

    if (row.count >= license.daily_limit) {
      return { limited: true as const, count: row.count };
    }

    db.raw
      .prepare("UPDATE beta_usage SET count = count + 1 WHERE license_id = ? AND day = ?")
      .run(license.id, day);

    return { limited: false as const, count: row.count + 1 };
  });

  if (result.limited) {
    throw new BetaError(
      "limit_reached",
      `Daily limit reached (${license.daily_limit}/${license.daily_limit} uses today). Resets at 00:00 UTC.`
    );
  }

  return {
    ok: true,
    usesRemainingToday: license.daily_limit - result.count,
    daysRemaining: Math.max(0, (license.expires_at - now) / (24 * 60 * 60 * 1000)),
  };
}
