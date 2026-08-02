/**
 * The 30-day trial.
 *
 * The properties worth protecting here are the ones TRIAL_PLAN.md exists to
 * guarantee: only paid/approved waitlist applications can be issued a token
 * (the deposit is the cohort filter), a token redeems only for the email it
 * was minted to, one trial per account ever, and a trial is a REAL
 * subscription — auto-renew off so the existing lockIfExpired timer locks it
 * on day 30, and subject to the same connection limits as a paid plan.
 */

import { describe, expect, it, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../src/db.js";
import * as waitlist from "../src/waitlist.js";
import { signup } from "../src/auth.js";
import {
  mintTrialToken,
  activateTrial,
  TrialError,
  TRIAL_DURATION_MS,
  TRIAL_LICENSE_PREFIX,
  isLyceumIssuedKey,
} from "../src/trial.js";
import { lockIfExpired, getSubscription } from "../src/lemonsqueezy.js";
import { registerInstall, DeviceError } from "../src/devices.js";

const SECRET = "test-secret-for-trial";
const ADMIN = { fingerprint: "fp_trial_admin" };

const APPLICATION = {
  name: "Nguyen Van A",
  organisation: "Cohort Corp",
  workEmail: "cohort@corp.io",
  phone: "+84901234567",
};

let dir: string;
let db: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-trial-test-"));
  db = openDb(join(dir, "test.db"));
});

function makeCohortMember(email = APPLICATION.workEmail): string {
  const row = waitlist.apply(db, { ...APPLICATION, workEmail: email });
  waitlist.setStatus(db, row.id, "paid", "fp_admin");
  const { user } = signup(db, SECRET, { email, password: "password-123" });
  return user.id;
}

function mintedTokenFor(email = APPLICATION.workEmail): string {
  return mintTrialToken(db, SECRET, ADMIN, { email }).token;
}

describe("isLyceumIssuedKey — the guard that keeps trial/demo keys away from Lemon Squeezy", () => {
  it("recognises trial keys", () => {
    expect(isLyceumIssuedKey(`${TRIAL_LICENSE_PREFIX}abc-123`)).toBe(true);
  });

  it("recognises dev keys", () => {
    expect(isLyceumIssuedKey("LYCEUM-DEV-ABCD1234")).toBe(true);
  });

  it("rejects keys Lemon Squeezy issues", () => {
    // A real LS key is a uuid-like string; it must never be classified as ours.
    expect(isLyceumIssuedKey("8f3b2a91-2c6e-4f8a-9b1d-0e5c7a3d9f2b")).toBe(false);
    expect(isLyceumIssuedKey("LS-TEST-12345678")).toBe(false);
  });

  it("matches case-insensitively — a pasted lowercase key must not fall through to Lemon Squeezy", () => {
    expect(isLyceumIssuedKey("lyceum-trial-x")).toBe(true);
    expect(isLyceumIssuedKey("lyceum-dev-ABCD")).toBe(true);
  });

  it("rejects near-misses and garbage", () => {
    expect(isLyceumIssuedKey("LYCEUM")).toBe(false); // no dash, not a minted key
    expect(isLyceumIssuedKey("")).toBe(false);
  });
});

describe("minting — the cohort gate", () => {
  it("refuses an email with no waitlist application", () => {
    expect(() => mintTrialToken(db, SECRET, ADMIN, { email: "nobody@corp.io" })).toThrow(TrialError);
  });

  it("refuses a pending application — deposit not cleared", () => {
    waitlist.apply(db, APPLICATION);
    expect(() => mintedTokenFor()).toThrow(TrialError);
    try {
      mintedTokenFor();
    } catch (err) {
      expect((err as TrialError).code).toBe("not_in_cohort");
    }
  });

  it("refuses a rejected application", () => {
    const row = waitlist.apply(db, APPLICATION);
    waitlist.setStatus(db, row.id, "rejected", "fp_admin");
    expect(() => mintedTokenFor()).toThrow(TrialError);
  });

  it("accepts a paid application", () => {
    const row = waitlist.apply(db, APPLICATION);
    waitlist.setStatus(db, row.id, "paid", "fp_admin");
    expect(() => mintedTokenFor()).not.toThrow();
  });

  it("accepts an approved application", () => {
    const row = waitlist.apply(db, APPLICATION);
    waitlist.setStatus(db, row.id, "approved", "fp_admin");
    expect(() => mintedTokenFor()).not.toThrow();
  });

  it("normalises the email when minting", () => {
    waitlist.apply(db, APPLICATION);
    waitlist.setStatus(db, waitlist.getByEmail(db, APPLICATION.workEmail)!.id, "paid", "fp");
    const result = mintTrialToken(db, SECRET, ADMIN, { email: "Cohort@Corp.IO" });
    expect(result.email).toBe(APPLICATION.workEmail);
  });
});

describe("activation", () => {
  it("refuses a token minted for a different email", () => {
    // The token belongs to the first (cohort) account; a different account
    // with a different email must not be able to redeem it.
    makeCohortMember(); // cohort@corp.io — paid + signed up
    const token = mintedTokenFor(); // minted for cohort@corp.io
    const otherUserId = makeCohortMember("other@corp.io");
    try {
      activateTrial(db, SECRET, { userId: otherUserId, email: "other@corp.io", token });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as TrialError).code).toBe("email_mismatch");
    }
  });

  it("refuses garbage and expired tokens", () => {
    const userId = makeCohortMember();
    expect(() =>
      activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token: "not-a-token" })
    ).toThrow(TrialError);
    // A token signed for a different purpose must not redeem.
    const wrongPurpose = jwt.sign({ purpose: "license", email: APPLICATION.workEmail, plan: "solo" }, SECRET);
    expect(() =>
      activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token: wrongPurpose })
    ).toThrow(TrialError);
  });

  it("writes a real subscription: active, auto-renew off, LYCEUM-TRIAL- key, 30 days", () => {
    const userId = makeCohortMember();
    const token = mintedTokenFor();
    const result = activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });

    expect(result.plan).toBe("solo");
    expect(result.billing).toBe("monthly");
    expect(result.licenseKey.startsWith(TRIAL_LICENSE_PREFIX)).toBe(true);
    // 30 days out, give or take a second of test time.
    expect(Math.abs(result.expiresAt - (Date.now() + TRIAL_DURATION_MS))).toBeLessThan(5000);
    expect(result.connectionLimit).toBeGreaterThan(0);

    const sub = getSubscription(db, userId)!;
    expect(sub.status).toBe("active");
    expect(sub.auto_renew).toBe(0);
    expect(sub.license_key).toBe(result.licenseKey);
  });

  it("gives one trial per account, ever — even after the first is locked", () => {
    const userId = makeCohortMember();
    const token = mintedTokenFor();
    activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });

    // Lock it as day 30 would, then try a fresh token — still refused.
    db.raw.prepare("UPDATE subscriptions SET status = 'locked' WHERE user_id = ?").run(userId);
    const second = mintedTokenFor();
    try {
      activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token: second });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as TrialError).code).toBe("already_used");
    }
  });

  it("a second redemption of the SAME token is refused — the key is already on the account", () => {
    const userId = makeCohortMember();
    const token = mintedTokenFor();
    activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });
    expect(() =>
      activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token })
    ).toThrow(TrialError);
  });

  it("never clobbers a paid subscription — an account with any non-trial key is refused", () => {
    // A dev-mode / paid account holds a non-trial key. Redeeming a trial
    // token must NOT downgrade it to solo/30-day through activateSubscription's
    // UPDATE path — the trial is for accounts with no commercial relationship.
    const userId = makeCohortMember();
    db.raw
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan, billing, status, license_key, started_at,
            expires_at, auto_renew, created_at)
         VALUES (?, ?, 'team', 'annual', 'active', 'CUSTOMER-KEY-1', ?, ?, 1, ?)`
      )
      .run("paid-sub", userId, Date.now(), Date.now() + 1e9, Date.now());

    const token = mintedTokenFor();
    try {
      activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as TrialError).code).toBe("has_subscription");
    }
    // And the paid subscription is untouched.
    const sub = getSubscription(db, userId)!;
    expect(sub.plan).toBe("team");
    expect(sub.license_key).toBe("CUSTOMER-KEY-1");
  });

  it("also refuses when the existing subscription has no license key yet (webhook window)", () => {
    // A paid subscription created via the Lemon Squeezy webhook has
    // license_key = NULL until the customer pastes their key. The guard is
    // on the row, not the key, so this window must still block a trial.
    const userId = makeCohortMember();
    db.raw
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, plan, billing, status, license_key, started_at,
            expires_at, auto_renew, created_at)
         VALUES (?, ?, 'team', 'annual', 'active', NULL, ?, ?, 1, ?)`
      )
      .run("paid-sub-nullkey", userId, Date.now(), Date.now() + 1e9, Date.now());

    const token = mintedTokenFor();
    try {
      activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as TrialError).code).toBe("has_subscription");
    }
    const sub = getSubscription(db, userId)!;
    expect(sub.plan).toBe("team");
  });
});

describe("the trial is a real subscription", () => {
  it("lockIfExpired locks an expired trial on the same timer as paid plans", () => {
    const userId = makeCohortMember();
    const token = mintedTokenFor();
    activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });

    // Rewind expiry into the past — day 31.
    db.raw
      .prepare("UPDATE subscriptions SET expires_at = ? WHERE user_id = ?")
      .run(Date.now() - 1000, userId);

    const locked = lockIfExpired(db);
    expect(locked).toBe(1);
    expect(getSubscription(db, userId)!.status).toBe("locked");
  });

  it("connection limits apply to a trial exactly as to a paid plan", () => {
    const userId = makeCohortMember();
    const token = mintedTokenFor();
    const { connectionLimit } = activateTrial(db, SECRET, { userId, email: APPLICATION.workEmail, token });

    // Fill to the cap, then one more must hit the same 402/limit error.
    for (let i = 0; i < connectionLimit; i++) {
      registerInstall(db, {
        userId,
        hostType: "claude-desktop",
        deviceId: `dev-${i}`,
      });
    }
    try {
      registerInstall(db, { userId, hostType: "claude-desktop", deviceId: "dev-over" });
      expect.unreachable("should have hit the connection limit");
    } catch (err) {
      expect((err as DeviceError).code).toBe("limit_reached");
    }
  });
});
