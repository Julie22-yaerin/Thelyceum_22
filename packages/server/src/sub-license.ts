/**
 * Subscription license pool — the manual-sale model.
 *
 * A fixed pool of pre-generated unlock codes, seeded once by an admin. A
 * customer pays through a channel this system never sees (a call, a bank
 * transfer), and the admin hands them one code and flips its status to
 * "taken" by hand, setting a subscription period from that moment. There is
 * no payment webhook here on purpose — status only ever changes because an
 * admin changed it, recorded in the same audit log as every other admin act.
 *
 * A code unlocks brake/redteam/thrift's core tools until expires_at, then
 * the CLI points back to the site to get a new one from whoever holds a
 * spare slot in the pool.
 */

import { randomUUID } from "node:crypto";
import type { DbHandle } from "./db.js";
import { recordAdminAction, type AdminIdentity } from "./admin.js";

export const SUB_LICENSE_PREFIX = "LYCEUM-SUB-";
const DEFAULT_SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;

export class SubLicenseError extends Error {
  constructor(
    public code: "invalid_input" | "not_found" | "invalid_status" | "invalid_key" | "not_taken" | "expired",
    message: string
  ) {
    super(message);
    this.name = "SubLicenseError";
  }
}

export interface SubLicenseRow {
  id: string;
  license_key: string;
  status: "not_taken" | "taken";
  label: string | null;
  created_at: number;
  taken_at: number | null;
  expires_at: number | null;
  first_checkin_at: number | null;
}

// ── Seed the pool (admin, idempotent) ───────────────────────────────────

export function seedLicensePool(db: DbHandle, identity: AdminIdentity, count = 10): SubLicenseRow[] {
  const { n } = db.raw.prepare("SELECT COUNT(*) AS n FROM subscription_licenses").get() as { n: number };
  if (n > 0) return listLicensePool(db);

  const now = Date.now();
  const insert = db.raw.prepare(
    `INSERT INTO subscription_licenses (id, license_key, status, label, created_at, taken_at, expires_at)
     VALUES (?, ?, 'not_taken', NULL, ?, NULL, NULL)`
  );
  db.tx(() => {
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      insert.run(id, `${SUB_LICENSE_PREFIX}${randomUUID()}`, now);
    }
  });
  recordAdminAction(db, identity, "sub_license.seed", { count });
  return listLicensePool(db);
}

// ── List (admin) ─────────────────────────────────────────────────────────

export function listLicensePool(db: DbHandle): SubLicenseRow[] {
  return db.raw
    .prepare("SELECT * FROM subscription_licenses ORDER BY created_at ASC")
    .all() as unknown as SubLicenseRow[];
}

// ── Set status (admin, manual) ───────────────────────────────────────────

export interface SetStatusInput {
  status: "taken" | "not_taken";
  label?: string;
  /** Subscription length from the moment it's marked taken. Defaults to 30 days. */
  durationMs?: number;
}

export function setLicenseStatus(
  db: DbHandle,
  identity: AdminIdentity,
  id: string,
  input: SetStatusInput
): SubLicenseRow {
  const row = db.raw.prepare("SELECT * FROM subscription_licenses WHERE id = ?").get(id) as SubLicenseRow | undefined;
  if (!row) throw new SubLicenseError("not_found", "No such license slot.");

  const now = Date.now();
  if (input.status === "taken") {
    const expiresAt = now + (input.durationMs ?? DEFAULT_SUBSCRIPTION_MS);
    db.raw
      .prepare("UPDATE subscription_licenses SET status = 'taken', label = ?, taken_at = ?, expires_at = ? WHERE id = ?")
      .run(input.label ?? row.label, now, expiresAt, id);
  } else {
    db.raw
      .prepare(
        "UPDATE subscription_licenses SET status = 'not_taken', label = NULL, taken_at = NULL, expires_at = NULL, first_checkin_at = NULL WHERE id = ?"
      )
      .run(id);
  }

  recordAdminAction(db, identity, "sub_license.status", { id, to: input.status, label: input.label ?? null });
  return db.raw.prepare("SELECT * FROM subscription_licenses WHERE id = ?").get(id) as unknown as SubLicenseRow;
}

// ── Validate (CLI, public) ────────────────────────────────────────────────

export interface ValidateResult {
  ok: true;
  expiresAt: number;
  daysRemaining: number;
  firstCheckinAt: number | null;
}

function loadByKey(db: DbHandle, licenseKey: string): SubLicenseRow {
  const row = db.raw
    .prepare("SELECT * FROM subscription_licenses WHERE license_key = ?")
    .get(licenseKey) as SubLicenseRow | undefined;
  if (!row) throw new SubLicenseError("invalid_key", "That license code isn't valid.");
  return row;
}

export function validateSubLicense(db: DbHandle, licenseKey: string): ValidateResult {
  const row = loadByKey(db, licenseKey);
  if (row.status !== "taken" || !row.expires_at) {
    throw new SubLicenseError("not_taken", "This code hasn't been activated yet. Contact us to activate it.");
  }
  const now = Date.now();
  if (now >= row.expires_at) {
    throw new SubLicenseError(
      "expired",
      `This code expired on ${new Date(row.expires_at).toISOString().slice(0, 10)}.`
    );
  }
  return {
    ok: true,
    expiresAt: row.expires_at,
    daysRemaining: Math.max(0, (row.expires_at - now) / (24 * 60 * 60 * 1000)),
    firstCheckinAt: row.first_checkin_at,
  };
}

// ── Check in (CLI only — called from the real /validate path, not /enter) ──
// Marks the moment an actual CLI, not just the redeem web page, first
// confirmed this key. Idempotent: only ever sets the column once.

export function markCheckedIn(db: DbHandle, licenseKey: string): void {
  db.raw
    .prepare("UPDATE subscription_licenses SET first_checkin_at = ? WHERE license_key = ? AND first_checkin_at IS NULL")
    .run(Date.now(), licenseKey);
}

// ── Cancel (self-service, public — the key itself is the credential) ───────
// Returns the slot to the pool immediately. No refund logic here; that's a
// conversation the "book a call" flow, not this endpoint, handles.

export function cancelSubLicense(db: DbHandle, licenseKey: string): void {
  const row = loadByKey(db, licenseKey);
  db.raw
    .prepare(
      "UPDATE subscription_licenses SET status = 'not_taken', label = NULL, taken_at = NULL, expires_at = NULL, first_checkin_at = NULL WHERE id = ?"
    )
    .run(row.id);
}

// ── Upgrade / extend (self-service, public) ─────────────────────────────────

export interface UpgradeResult {
  ok: true;
  expiresAt: number;
  daysRemaining: number;
}

export function upgradeSubLicense(db: DbHandle, licenseKey: string, months: number): UpgradeResult {
  if (!(months > 0) || !Number.isFinite(months)) {
    throw new SubLicenseError("invalid_input", "months must be a positive number.");
  }
  const row = loadByKey(db, licenseKey);
  if (row.status !== "taken" || !row.expires_at) {
    throw new SubLicenseError("not_taken", "This code hasn't been activated yet.");
  }
  // Extend from expiry if still active (a renewal shouldn't shorten unused
  // time), from now if it already lapsed (extending from a past date would
  // under-credit the purchase).
  const base = Math.max(row.expires_at, Date.now());
  const expiresAt = base + months * 30 * 24 * 60 * 60 * 1000;
  db.raw.prepare("UPDATE subscription_licenses SET expires_at = ? WHERE id = ?").run(expiresAt, row.id);
  return {
    ok: true,
    expiresAt,
    daysRemaining: (expiresAt - Date.now()) / (24 * 60 * 60 * 1000),
  };
}

// ── Auto-assign (system actor — a confirmed on-chain payment, not an admin) ─
// Same effect as setLicenseStatus(taken), but for a caller that isn't a
// human admin: no AdminIdentity to attribute the action to, so it logs to
// the same audit_events table under a "system:" actor instead of
// "admin:<fingerprint>" — visible in the same admin console audit list,
// clearly distinguishable from a hand action.

export function autoAssignLicense(db: DbHandle, label: string, durationMs = DEFAULT_SUBSCRIPTION_MS): SubLicenseRow {
  const slot = db.raw
    .prepare("SELECT * FROM subscription_licenses WHERE status = 'not_taken' ORDER BY created_at ASC LIMIT 1")
    .get() as SubLicenseRow | undefined;
  if (!slot) {
    throw new SubLicenseError("not_found", "No license slots available — the pool is fully sold. Contact the operator to add more.");
  }

  const now = Date.now();
  const expiresAt = now + durationMs;
  db.raw
    .prepare("UPDATE subscription_licenses SET status = 'taken', label = ?, taken_at = ?, expires_at = ? WHERE id = ?")
    .run(label, now, expiresAt, slot.id);

  db.raw
    .prepare("INSERT INTO audit_events (user_id, event, data, created_at) VALUES (?, ?, ?, ?)")
    .run("system:solana-pay", "sub_license.auto_assign", JSON.stringify({ id: slot.id, label }), now);

  return db.raw.prepare("SELECT * FROM subscription_licenses WHERE id = ?").get(slot.id) as unknown as SubLicenseRow;
}
