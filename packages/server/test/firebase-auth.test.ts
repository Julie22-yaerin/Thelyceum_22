/**
 * Firebase signup completion.
 *
 * verifyIdToken is never really called — a fake TokenVerifier stands in, so
 * these tests never touch Firebase's real network-backed verification (which
 * would mean a live project and a real signed token to test against, neither
 * reproducible in CI). What's under test is everything downstream of a
 * decoded token: unverified emails don't get a license, verified ones do,
 * repeat calls are idempotent, and pool exhaustion surfaces as a clear error
 * instead of an unhandled type.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../src/db.js";
import { seedLicensePool } from "../src/sub-license.js";
import { completeSignup, listFirebaseSignups, getPublicWebConfig, FirebaseAuthError, type TokenVerifier, type DecodedToken } from "../src/firebase-auth.js";

const ADMIN = { fingerprint: "fp_firebase_admin" };

let dir: string;
let db: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-firebase-auth-test-"));
  db = openDb(join(dir, "test.db"));
  seedLicensePool(db, ADMIN, 2);
});

function fakeVerifier(decoded: DecodedToken | (() => Promise<DecodedToken>)): TokenVerifier {
  return {
    verifyIdToken: async () => (typeof decoded === "function" ? decoded() : decoded),
  };
}

const GOOGLE_USER: DecodedToken = {
  uid: "uid-google-1",
  email: "dev@example.com",
  email_verified: true,
  name: "Dev Person",
  firebase: { sign_in_provider: "google.com" },
};

const UNVERIFIED_EMAIL_USER: DecodedToken = {
  uid: "uid-email-1",
  email: "notverified@example.com",
  email_verified: false,
  firebase: { sign_in_provider: "password" },
};

describe("completeSignup", () => {
  it("issues a license immediately for an already-verified (Google) token", async () => {
    const result = await completeSignup(db, { idToken: "x", name: "Dev Person" }, fakeVerifier(GOOGLE_USER));
    expect(result.verified).toBe(true);
    expect(result.licenseKey).toMatch(/^[A-Z0-9]{8}$/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("does NOT issue a license for an unverified email — returns verified:false instead", async () => {
    const result = await completeSignup(db, { idToken: "x", name: "Someone" }, fakeVerifier(UNVERIFIED_EMAIL_USER));
    expect(result.verified).toBe(false);
    expect(result.licenseKey).toBeUndefined();
  });

  it("records the signup for admin visibility", async () => {
    await completeSignup(db, { idToken: "x", name: "Dev Person" }, fakeVerifier(GOOGLE_USER));
    const signups = listFirebaseSignups(db);
    expect(signups).toHaveLength(1);
    expect(signups[0].email).toBe("dev@example.com");
    expect(signups[0].name).toBe("Dev Person");
    expect(signups[0].provider).toBe("google.com");
    expect(signups[0].license_id).not.toBeNull();
  });

  it("is idempotent — completing signup twice for the same uid returns the same license, not a second one", async () => {
    const first = await completeSignup(db, { idToken: "x", name: "Dev Person" }, fakeVerifier(GOOGLE_USER));
    const second = await completeSignup(db, { idToken: "x", name: "Dev Person" }, fakeVerifier(GOOGLE_USER));
    expect(second.licenseKey).toBe(first.licenseKey);
    expect(listFirebaseSignups(db)).toHaveLength(1);
  });

  it("falls back to the token's name, then the email prefix, when no name is supplied", async () => {
    await completeSignup(db, { idToken: "x", name: "" }, fakeVerifier(GOOGLE_USER));
    expect(listFirebaseSignups(db)[0].name).toBe("Dev Person");

    const noName: DecodedToken = { uid: "uid-2", email: "plain@example.com", email_verified: true };
    await completeSignup(db, { idToken: "x", name: "" }, fakeVerifier(noName));
    const row = listFirebaseSignups(db).find((s) => s.uid === "uid-2");
    expect(row?.name).toBe("plain");
  });

  it("rejects a token that fails verification", async () => {
    const throwing: TokenVerifier = {
      verifyIdToken: async () => {
        throw new Error("bad signature");
      },
    };
    await expect(completeSignup(db, { idToken: "x", name: "x" }, throwing)).rejects.toThrow(FirebaseAuthError);
  });

  it("rejects a token with no email", async () => {
    const noEmail: DecodedToken = { uid: "uid-3", email_verified: true };
    await expect(completeSignup(db, { idToken: "x", name: "x" }, fakeVerifier(noEmail))).rejects.toThrow(
      FirebaseAuthError
    );
  });

  it("surfaces pool exhaustion as a clear FirebaseAuthError, not a raw SubLicenseError", async () => {
    // Pool seeded with 2 in beforeEach — take both.
    const rows = db.raw.prepare("SELECT id FROM subscription_licenses").all() as { id: string }[];
    for (const row of rows) {
      db.raw
        .prepare("UPDATE subscription_licenses SET status = 'taken', taken_at = ?, expires_at = ? WHERE id = ?")
        .run(Date.now(), Date.now() + 1000, row.id);
    }
    await expect(
      completeSignup(db, { idToken: "x", name: "x" }, fakeVerifier({ ...GOOGLE_USER, uid: "uid-overflow" }))
    ).rejects.toThrow(FirebaseAuthError);
  });
});

describe("getPublicWebConfig", () => {
  const KEYS = [
    "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_APP_ID",
  ];

  it("returns null when not fully configured", () => {
    for (const k of KEYS) delete process.env[k];
    expect(getPublicWebConfig()).toBeNull();
  });

  it("returns the full config once every key is set", () => {
    for (const k of KEYS) process.env[k] = `test-${k}`;
    const config = getPublicWebConfig();
    expect(config).not.toBeNull();
    expect(config?.apiKey).toBe("test-FIREBASE_API_KEY");
    for (const k of KEYS) delete process.env[k];
  });
});
