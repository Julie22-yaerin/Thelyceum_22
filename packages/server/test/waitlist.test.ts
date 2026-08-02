/**
 * Waitlist and admin.
 *
 * The properties worth protecting here are about *who gets in* and *who can
 * decide that*, so the tests are written against those rather than against
 * the happy path: a free-mail address is refused, a duplicate is told where it
 * stands instead of erroring, a repeat webhook cannot rewind an approval, and
 * an admin key from the database never grants admin.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type DbHandle } from "../src/db.js";
import * as waitlist from "../src/waitlist.js";
import { authenticateAdmin, fingerprint, recordAdminAction, recentAdminActions } from "../src/admin.js";

let dir: string;
let db: DbHandle;

const VALID = {
  name: "Tran Thi B",
  organisation: "Fleet Corp",
  workEmail: "b@fleetcorp.io",
  phone: "+84901234567",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-test-"));
  db = openDb(join(dir, "test.db"));
});

describe("application validation", () => {
  it("accepts a complete application from a work address", () => {
    expect(waitlist.validateApplication(VALID)).toEqual([]);
  });

  it("refuses consumer mail domains", () => {
    for (const domain of ["gmail.com", "outlook.com", "icloud.com", "proton.me"]) {
      const errors = waitlist.validateApplication({ ...VALID, workEmail: `x@${domain}` });
      expect(errors.some((e) => e.field === "workEmail"), domain).toBe(true);
    }
  });

  it("refuses disposable mail domains", () => {
    const errors = waitlist.validateApplication({ ...VALID, workEmail: "x@mailinator.com" });
    expect(errors.some((e) => e.field === "workEmail")).toBe(true);
  });

  it("tells a free-mail applicant what to do rather than only refusing", () => {
    // A dead-end rejection loses a lead who may be a real prospect at a small
    // company. The message has to offer a route.
    const errors = waitlist.validateApplication({ ...VALID, workEmail: "x@gmail.com" });
    expect(errors[0].message).toMatch(/email us directly/i);
  });

  it("returns every problem at once, not just the first", () => {
    const errors = waitlist.validateApplication({
      name: "A",
      organisation: "",
      workEmail: "nope",
      phone: "abc",
    });
    expect(errors.map((e) => e.field).sort()).toEqual(
      ["name", "organisation", "phone", "workEmail"].sort()
    );
  });

  it("accepts international phone formats without being clever about it", () => {
    for (const phone of ["+84901234567", "+1 (415) 555-0134", "0901234567", "+44 20 7946 0958"]) {
      const errors = waitlist.validateApplication({ ...VALID, phone });
      expect(errors.some((e) => e.field === "phone"), phone).toBe(false);
    }
  });
});

describe("applying", () => {
  it("stores an application as pending — never auto-approved", () => {
    const row = waitlist.apply(db, VALID);
    expect(row.status).toBe("pending");
    expect(row.deposit_cents).toBe(0);
  });

  it("normalises the email so a case variant is still a duplicate", () => {
    waitlist.apply(db, VALID);
    expect(() =>
      waitlist.apply(db, { ...VALID, workEmail: "B@FleetCorp.IO" })
    ).toThrow(waitlist.WaitlistError);
  });

  it("tells a duplicate applicant where they stand", () => {
    waitlist.apply(db, VALID);
    try {
      waitlist.apply(db, VALID);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as waitlist.WaitlistError).code).toBe("already_applied");
      expect((err as Error).message).toMatch(/already on the list/i);
    }
  });

  it("refuses an invalid application outright", () => {
    expect(() => waitlist.apply(db, { ...VALID, workEmail: "x@gmail.com" })).toThrow(
      waitlist.WaitlistError
    );
    expect(waitlist.list(db)).toHaveLength(0);
  });
});

describe("the 50-application cap", () => {
  // Import here rather than at module scope so it's obvious in the test
  // itself which constant governs the cap, without hunting through plans.ts.
  const MAX = 50 as const;

  it("accepts applications up to the cap", () => {
    for (let i = 0; i < MAX; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    expect(waitlist.activeCount(db)).toBe(MAX);
  });

  it("refuses the application that would exceed the cap", () => {
    for (let i = 0; i < MAX; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    try {
      waitlist.apply(db, { ...VALID, workEmail: "one-too-many@fleetcorp.io" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as waitlist.WaitlistError).code).toBe("waitlist_full");
      expect((err as Error).message).toMatch(/full/i);
    }
    // And nothing was written for the refused attempt.
    expect(waitlist.activeCount(db)).toBe(MAX);
    expect(waitlist.getByEmail(db, "one-too-many@fleetcorp.io")).toBeNull();
  });

  it("checks identity and duplicates BEFORE the cap — someone already on a full list gets their real status, not 'full'", () => {
    for (let i = 0; i < MAX; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    try {
      // person0 is already on the (now full) list — re-applying must surface
      // "already applied", never "waitlist full", or an existing applicant
      // checking their own status gets a confusing, wrong answer.
      waitlist.apply(db, { ...VALID, workEmail: "person0@fleetcorp.io" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as waitlist.WaitlistError).code).toBe("already_applied");
    }
  });

  it("a rejected application frees its slot", () => {
    for (let i = 0; i < MAX; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    const row = waitlist.getByEmail(db, "person0@fleetcorp.io")!;
    waitlist.setStatus(db, row.id, "rejected", "admin_fp");
    expect(waitlist.activeCount(db)).toBe(MAX - 1);

    // The freed slot is real: one more application now succeeds.
    expect(() =>
      waitlist.apply(db, { ...VALID, workEmail: "newcomer@fleetcorp.io" })
    ).not.toThrow();
    expect(waitlist.activeCount(db)).toBe(MAX);
  });

  it("approving or leaving pending does NOT free a slot — only rejection does", () => {
    for (let i = 0; i < MAX; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    const row = waitlist.getByEmail(db, "person0@fleetcorp.io")!;
    waitlist.setStatus(db, row.id, "approved", "admin_fp");
    expect(waitlist.activeCount(db)).toBe(MAX); // still full — approved still counts
    expect(() => waitlist.apply(db, { ...VALID, workEmail: "newcomer@fleetcorp.io" })).toThrow(
      waitlist.WaitlistError
    );
  });

  it("publicAvailability reports taken/max/full without leaking any row", () => {
    for (let i = 0; i < 3; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    const avail = waitlist.publicAvailability(db);
    expect(avail).toEqual({ taken: 3, max: MAX, full: false });
    expect(Object.keys(avail).sort()).toEqual(["full", "max", "taken"]);
  });

  it("publicAvailability.full flips true exactly at the cap", () => {
    for (let i = 0; i < MAX; i++) {
      waitlist.apply(db, { ...VALID, workEmail: `person${i}@fleetcorp.io` });
    }
    expect(waitlist.publicAvailability(db).full).toBe(true);
  });
});

describe("deposit", () => {
  it("moves a pending application to paid", () => {
    const row = waitlist.apply(db, VALID);
    const updated = waitlist.markDepositPaid(db, row.work_email, 5000, "order_1");
    expect(updated?.status).toBe("paid");
    expect(updated?.deposit_cents).toBe(5000);
  });

  it("does not rewind an approval when the webhook is redelivered", () => {
    // Lemon Squeezy retries on any non-2xx, so the same order_created can
    // arrive after an admin has already approved. That must not undo it.
    const row = waitlist.apply(db, VALID);
    waitlist.markDepositPaid(db, row.work_email, 5000, "order_1");
    waitlist.setStatus(db, row.id, "approved", "admin_fp");

    const after = waitlist.markDepositPaid(db, row.work_email, 5000, "order_1");
    expect(after?.status).toBe("approved");
  });

  it("ignores a deposit for an email that never applied", () => {
    expect(waitlist.markDepositPaid(db, "nobody@example.com", 5000, "order_x")).toBeNull();
  });
});

describe("review", () => {
  it("records who reviewed and when", () => {
    const row = waitlist.apply(db, VALID);
    const approved = waitlist.setStatus(db, row.id, "approved", "fp_abc");
    expect(approved?.status).toBe("approved");
    expect(approved?.reviewed_by).toBe("fp_abc");
    expect(approved?.reviewed_at).toBeGreaterThan(0);
  });

  it("counts by status", () => {
    const a = waitlist.apply(db, VALID);
    waitlist.apply(db, { ...VALID, workEmail: "c@other.io" });
    waitlist.setStatus(db, a.id, "approved", "fp");

    const counts = waitlist.counts(db);
    expect(counts.total).toBe(2);
    expect(counts.approved).toBe(1);
    expect(counts.pending).toBe(1);
  });

  it("filters by status", () => {
    const a = waitlist.apply(db, VALID);
    waitlist.apply(db, { ...VALID, workEmail: "c@other.io" });
    waitlist.setStatus(db, a.id, "rejected", "fp");
    expect(waitlist.list(db, { status: "rejected" })).toHaveLength(1);
  });
});

describe("admin authentication", () => {
  const KEY = "LYC-ADMIN-abc123def456ghi789";

  it("rejects everything when no admin key is configured", () => {
    delete process.env.LYCEUM_ADMIN_KEYS;
    expect(authenticateAdmin(KEY)).toBeNull();
  });

  it("accepts a configured key and rejects anything else", () => {
    process.env.LYCEUM_ADMIN_KEYS = KEY;
    expect(authenticateAdmin(KEY)).not.toBeNull();
    expect(authenticateAdmin("wrong")).toBeNull();
    expect(authenticateAdmin(undefined)).toBeNull();
    expect(authenticateAdmin("")).toBeNull();
  });

  it("supports several admin keys", () => {
    process.env.LYCEUM_ADMIN_KEYS = `${KEY}, LYC-ADMIN-second-key-value`;
    expect(authenticateAdmin(KEY)).not.toBeNull();
    expect(authenticateAdmin("LYC-ADMIN-second-key-value")).not.toBeNull();
  });

  it("gives different admins different fingerprints, and never returns the key", () => {
    process.env.LYCEUM_ADMIN_KEYS = KEY;
    const id = authenticateAdmin(KEY)!;
    expect(id.fingerprint).not.toContain("abc123");
    expect(id.fingerprint).toHaveLength(12);
    expect(fingerprint("other")).not.toBe(id.fingerprint);
  });

  it("does NOT grant admin from a subscription license key in the database", () => {
    // The whole point of reading admin keys from env: a leaked database or a
    // SQL injection must not be an admin takeover, and buying a licence must
    // not be one step from the console.
    process.env.LYCEUM_ADMIN_KEYS = KEY;
    db.raw
      .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)")
      .run("u1", "customer@example.com", "hash", Date.now());
    db.raw
      .prepare(
        `INSERT INTO subscriptions (id, user_id, plan, billing, status, license_key,
           started_at, expires_at, auto_renew, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run("s1", "u1", "team", "monthly", "active", "CUSTOMER-KEY-123", Date.now(), Date.now() + 1e9, 1, Date.now());

    expect(authenticateAdmin("CUSTOMER-KEY-123")).toBeNull();
  });
});

describe("admin audit", () => {
  it("logs the fingerprint and never the key", () => {
    process.env.LYCEUM_ADMIN_KEYS = "LYC-ADMIN-secret-value-here";
    const id = authenticateAdmin("LYC-ADMIN-secret-value-here")!;
    recordAdminAction(db, id, "waitlist.status", { organisation: "Fleet Corp", to: "approved" });

    const entries = recentAdminActions(db);
    expect(entries).toHaveLength(1);
    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain("secret-value-here");
    expect(entries[0].user_id).toBe(`admin:${id.fingerprint}`);
  });
});
