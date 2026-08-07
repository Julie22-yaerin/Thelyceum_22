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
      .prepare("UPDATE subscription_licenses SET status = 'not_taken', label = NULL, taken_at = NULL, expires_at = NULL WHERE id = ?")
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
}

export function validateSubLicense(db: DbHandle, licenseKey: string): ValidateResult {
  const row = db.raw
    .prepare("SELECT * FROM subscription_licenses WHERE license_key = ?")
    .get(licenseKey) as SubLicenseRow | undefined;
  if (!row) throw new SubLicenseError("invalid_key", "That license code isn't valid.");
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
  };
}
