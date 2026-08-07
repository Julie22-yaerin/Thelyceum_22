/**
 * Subscription license pool — the manual-sale model.
 *
 * The properties worth protecting: seeding is idempotent (never doubles the
 * pool on a re-run), status only ever changes on an explicit admin call
 * (never inferred), taking a slot starts its own subscription clock, an
 * un-taken slot's code doesn't validate, and expiry is enforced.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../src/db.js";
import {
  seedLicensePool,
  listLicensePool,
  setLicenseStatus,
  validateSubLicense,
  markCheckedIn,
  cancelSubLicense,
  upgradeSubLicense,
  SubLicenseError,
  SUB_LICENSE_PREFIX,
} from "../src/sub-license.js";

const ADMIN = { fingerprint: "fp_sub_license_admin" };

let dir: string;
let db: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-sub-license-test-"));
  db = openDb(join(dir, "test.db"));
});

describe("seedLicensePool", () => {
  it("creates 10 not_taken slots by default", () => {
    const pool = seedLicensePool(db, ADMIN);
    expect(pool).toHaveLength(10);
    expect(pool.every((r) => r.status === "not_taken")).toBe(true);
    expect(pool.every((r) => r.license_key.startsWith(SUB_LICENSE_PREFIX))).toBe(true);
    expect(new Set(pool.map((r) => r.license_key)).size).toBe(10);
  });

  it("is idempotent — a second seed call doesn't add more", () => {
    seedLicensePool(db, ADMIN);
    const again = seedLicensePool(db, ADMIN);
    expect(again).toHaveLength(10);
    expect(listLicensePool(db)).toHaveLength(10);
  });

  it("honors an explicit count on first seed only", () => {
    const pool = seedLicensePool(db, ADMIN, 3);
    expect(pool).toHaveLength(3);
  });
});

describe("setLicenseStatus", () => {
  it("marking taken sets a ~30-day expiry and a label", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    const before = Date.now();
    const updated = setLicenseStatus(db, ADMIN, slot.id, { status: "taken", label: "acme-corp" });
    expect(updated.status).toBe("taken");
    expect(updated.label).toBe("acme-corp");
    expect(updated.taken_at).toBeGreaterThanOrEqual(before);
    expect(updated.expires_at! - before).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(updated.expires_at! - before).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("honors a custom durationMs", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    const before = Date.now();
    const updated = setLicenseStatus(db, ADMIN, slot.id, { status: "taken", durationMs: 7 * 24 * 60 * 60 * 1000 });
    expect(updated.expires_at! - before).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });

  it("flipping back to not_taken clears label/taken_at/expires_at", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken", label: "acme" });
    const reverted = setLicenseStatus(db, ADMIN, slot.id, { status: "not_taken" });
    expect(reverted.status).toBe("not_taken");
    expect(reverted.label).toBeNull();
    expect(reverted.taken_at).toBeNull();
    expect(reverted.expires_at).toBeNull();
  });

  it("throws not_found for a nonexistent id", () => {
    expect(() => setLicenseStatus(db, ADMIN, "nonexistent", { status: "taken" })).toThrow(SubLicenseError);
  });
});

describe("validateSubLicense", () => {
  it("rejects a code that was never taken", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    try {
      validateSubLicense(db, slot.license_key);
      expect.unreachable("not_taken code must be rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(SubLicenseError);
      expect((err as SubLicenseError).code).toBe("not_taken");
    }
  });

  it("accepts a taken, unexpired code", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken" });
    const result = validateSubLicense(db, slot.license_key);
    expect(result.ok).toBe(true);
    expect(result.daysRemaining).toBeGreaterThan(29);
  });

  it("rejects an expired code", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken" });
    db.raw.prepare("UPDATE subscription_licenses SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, slot.id);
    try {
      validateSubLicense(db, slot.license_key);
      expect.unreachable("expired code must be rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(SubLicenseError);
      expect((err as SubLicenseError).code).toBe("expired");
    }
  });

  it("rejects a garbage key", () => {
    expect(() => validateSubLicense(db, "not-a-real-key")).toThrow(SubLicenseError);
  });

  it("rejects a code from a pool that flipped back to not_taken", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken" });
    setLicenseStatus(db, ADMIN, slot.id, { status: "not_taken" });
    expect(() => validateSubLicense(db, slot.license_key)).toThrow(SubLicenseError);
  });
});

describe("markCheckedIn", () => {
  it("sets first_checkin_at on first call and leaves it alone after", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken" });

    expect(validateSubLicense(db, slot.license_key).firstCheckinAt).toBeNull();
    markCheckedIn(db, slot.license_key);
    const first = validateSubLicense(db, slot.license_key).firstCheckinAt;
    expect(first).not.toBeNull();

    markCheckedIn(db, slot.license_key);
    expect(validateSubLicense(db, slot.license_key).firstCheckinAt).toBe(first);
  });

  it("is a silent no-op for a key that doesn't exist", () => {
    expect(() => markCheckedIn(db, "not-a-real-key")).not.toThrow();
  });
});

describe("cancelSubLicense", () => {
  it("returns the slot to the pool, clearing label/expiry/check-in", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken", label: "acme" });
    markCheckedIn(db, slot.license_key);

    cancelSubLicense(db, slot.license_key);

    const pool = listLicensePool(db);
    const row = pool.find((r) => r.id === slot.id)!;
    expect(row.status).toBe("not_taken");
    expect(row.label).toBeNull();
    expect(row.expires_at).toBeNull();
    expect(row.first_checkin_at).toBeNull();
    expect(() => validateSubLicense(db, slot.license_key)).toThrow(SubLicenseError);
  });

  it("throws for an unknown key", () => {
    expect(() => cancelSubLicense(db, "not-a-real-key")).toThrow(SubLicenseError);
  });
});

describe("upgradeSubLicense", () => {
  it("extends an active license from its current expiry, not from now", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    const taken = setLicenseStatus(db, ADMIN, slot.id, { status: "taken", durationMs: 5 * 24 * 60 * 60 * 1000 });

    const result = upgradeSubLicense(db, slot.license_key, 1);
    expect(result.expiresAt - taken.expires_at!).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(result.expiresAt - taken.expires_at!).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("extends a lapsed license from now, not from its stale expiry", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken" });
    db.raw.prepare("UPDATE subscription_licenses SET expires_at = ? WHERE id = ?").run(Date.now() - 100_000_000, slot.id);

    const before = Date.now();
    const result = upgradeSubLicense(db, slot.license_key, 1);
    expect(result.expiresAt - before).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("rejects a license that was never taken", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    expect(() => upgradeSubLicense(db, slot.license_key, 1)).toThrow(SubLicenseError);
  });

  it("rejects zero or negative months", () => {
    const [slot] = seedLicensePool(db, ADMIN);
    setLicenseStatus(db, ADMIN, slot.id, { status: "taken" });
    expect(() => upgradeSubLicense(db, slot.license_key, 0)).toThrow(SubLicenseError);
    expect(() => upgradeSubLicense(db, slot.license_key, -1)).toThrow(SubLicenseError);
  });
});
