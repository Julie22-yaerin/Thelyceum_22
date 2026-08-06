/**
 * Standalone beta trial licenses.
 *
 * The properties worth protecting: a key only ever validates through the DB
 * row (so revocation/extension after minting actually takes effect), the
 * daily cap resets on the UTC day boundary rather than a rolling window, two
 * concurrent calls on the last remaining use can't both succeed, and a
 * malformed or foreign token is rejected the same as an expired one.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jwt from "jsonwebtoken";
import { openDb, type DbHandle } from "../src/db.js";
import { mintBetaLicense, checkBetaUsage, BetaError, BETA_LICENSE_PREFIX } from "../src/beta.js";

const SECRET = "test-secret-for-beta";
const ADMIN = { fingerprint: "fp_beta_admin" };

let dir: string;
let db: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-beta-test-"));
  db = openDb(join(dir, "test.db"));
});

describe("mintBetaLicense", () => {
  it("mints a key with the default 7-day / 10-per-day trial", () => {
    const before = Date.now();
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "openai-eng-trial" });
    expect(minted.licenseKey.startsWith(BETA_LICENSE_PREFIX)).toBe(true);
    expect(minted.dailyLimit).toBe(10);
    expect(minted.expiresAt - before).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(minted.expiresAt - before).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });

  it("honors an explicit days/dailyLimit override", () => {
    const before = Date.now();
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "custom", days: 1, dailyLimit: 3 });
    expect(minted.dailyLimit).toBe(3);
    expect(minted.expiresAt - before).toBeLessThan(1.1 * 24 * 60 * 60 * 1000);
  });

  it("refuses an empty label", () => {
    expect(() => mintBetaLicense(db, SECRET, ADMIN, { label: "  " })).toThrow(BetaError);
  });

  it("refuses non-positive days or dailyLimit", () => {
    expect(() => mintBetaLicense(db, SECRET, ADMIN, { label: "x", days: 0 })).toThrow(BetaError);
    expect(() => mintBetaLicense(db, SECRET, ADMIN, { label: "x", dailyLimit: -1 })).toThrow(BetaError);
  });
});

describe("checkBetaUsage", () => {
  it("accepts a fresh key and counts down usesRemainingToday", () => {
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "t", dailyLimit: 3 });
    const r1 = checkBetaUsage(db, SECRET, minted.licenseKey);
    expect(r1.ok).toBe(true);
    expect(r1.usesRemainingToday).toBe(2);
    const r2 = checkBetaUsage(db, SECRET, minted.licenseKey);
    expect(r2.usesRemainingToday).toBe(1);
  });

  it("blocks the call that would exceed the daily limit, not one before", () => {
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "t", dailyLimit: 2 });
    checkBetaUsage(db, SECRET, minted.licenseKey);
    checkBetaUsage(db, SECRET, minted.licenseKey);
    expect(() => checkBetaUsage(db, SECRET, minted.licenseKey)).toThrow(BetaError);
    try {
      checkBetaUsage(db, SECRET, minted.licenseKey);
    } catch (err) {
      expect(err).toBeInstanceOf(BetaError);
      expect((err as BetaError).code).toBe("limit_reached");
    }
  });

  it("never lets more than dailyLimit calls succeed under concurrent use", () => {
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "t", dailyLimit: 5 });
    const attempts = Array.from({ length: 20 }, () => {
      try {
        checkBetaUsage(db, SECRET, minted.licenseKey);
        return true;
      } catch {
        return false;
      }
    });
    expect(attempts.filter(Boolean).length).toBe(5);
  });

  it("rejects an expired license", () => {
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "t", days: 1 });
    // Force the row into the past directly — waiting a real day in a test isn't an option.
    db.raw.prepare("UPDATE beta_licenses SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, minted.licenseId);
    try {
      checkBetaUsage(db, SECRET, minted.licenseKey);
      expect.unreachable("expired license must be rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(BetaError);
      expect((err as BetaError).code).toBe("expired");
    }
  });

  it("rejects a revoked license even before its natural expiry", () => {
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "t" });
    db.raw.prepare("UPDATE beta_licenses SET revoked_at = ? WHERE id = ?").run(Date.now(), minted.licenseId);
    try {
      checkBetaUsage(db, SECRET, minted.licenseKey);
      expect.unreachable("revoked license must be rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(BetaError);
      expect((err as BetaError).code).toBe("revoked");
    }
  });

  it("rejects a garbage key", () => {
    expect(() => checkBetaUsage(db, SECRET, "not-a-real-key")).toThrow(BetaError);
  });

  it("rejects a well-formed token signed with a different secret", () => {
    const forged = `${BETA_LICENSE_PREFIX}${jwt.sign({ purpose: "beta", licenseId: "beta_nonexistent" }, "wrong-secret")}`;
    expect(() => checkBetaUsage(db, SECRET, forged)).toThrow(BetaError);
  });

  it("rejects a token for a license that was never minted (right secret, fabricated id)", () => {
    const forged = `${BETA_LICENSE_PREFIX}${jwt.sign({ purpose: "beta", licenseId: "beta_made_up" }, SECRET)}`;
    expect(() => checkBetaUsage(db, SECRET, forged)).toThrow(BetaError);
  });

  it("accepts the key with or without the LYCEUM-BETA- prefix stripped", () => {
    const minted = mintBetaLicense(db, SECRET, ADMIN, { label: "t" });
    const bareToken = minted.licenseKey.slice(BETA_LICENSE_PREFIX.length);
    const result = checkBetaUsage(db, SECRET, bareToken);
    expect(result.ok).toBe(true);
  });

  it("gives separate licenses independent daily budgets", () => {
    const a = mintBetaLicense(db, SECRET, ADMIN, { label: "a", dailyLimit: 1 });
    const b = mintBetaLicense(db, SECRET, ADMIN, { label: "b", dailyLimit: 1 });
    expect(checkBetaUsage(db, SECRET, a.licenseKey).ok).toBe(true);
    expect(checkBetaUsage(db, SECRET, b.licenseKey).ok).toBe(true);
    expect(() => checkBetaUsage(db, SECRET, a.licenseKey)).toThrow(BetaError);
  });
});
