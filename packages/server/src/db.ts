/**
 * SQLite store using Node's built-in `node:sqlite` (stable from Node 22.5+).
 *
 * No native compilation, no extra dependency. The whole app's data fits in
 * one file; SQLite is the right tool until it isn't, and Postgres migration
 * is a thin wrapper swap when the time comes.
 */

import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { PlanId } from "./plans.js";

export interface DbHandle {
  raw: DatabaseSync;
  /** Run a function inside a transaction. */
  tx<T>(fn: () => T): T;
}

export function openDb(path: string): DbHandle {
  mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA journal_mode = WAL");
  raw.exec("PRAGMA foreign_keys = ON");
  migrate(raw);
  return {
    raw,
    tx<T>(fn: () => T): T {
      raw.exec("BEGIN");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                      TEXT PRIMARY KEY,
      user_id                 TEXT NOT NULL UNIQUE,
      plan                    TEXT NOT NULL,
      billing                 TEXT NOT NULL,
      status                  TEXT NOT NULL,
      ls_subscription_id      TEXT,
      -- The key Lemon Squeezy issued and emailed. Mirrored here so day-to-day
      -- validation is a local lookup: an outage on their side must not stop a
      -- paying customer's agents from running.
      license_key             TEXT UNIQUE,
      -- Extra connections bought individually on top of the plan's allowance.
      -- Kept separate from the plan column so a plan change never silently
      -- discards add-ons the customer paid for.
      addon_connections       INTEGER NOT NULL DEFAULT 0,
      started_at              INTEGER NOT NULL,
      expires_at              INTEGER NOT NULL,
      auto_renew              INTEGER NOT NULL DEFAULT 1,
      locked_at               INTEGER,
      created_at              INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ── Waitlist ─────────────────────────────────────────────────────────
    -- Applications, not signups. Each one is reviewed before approval, and
    -- carries a refundable deposit so the list reflects intent rather than
    -- idle curiosity.
    CREATE TABLE IF NOT EXISTS waitlist (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      organisation    TEXT NOT NULL,
      work_email      TEXT NOT NULL UNIQUE,
      phone           TEXT NOT NULL,
      fleet_size      TEXT,
      note            TEXT,
      -- pending → deposit not yet paid; paid → deposit received, awaiting
      -- review; approved → may create an account; rejected → declined.
      status          TEXT NOT NULL DEFAULT 'pending',
      deposit_cents   INTEGER NOT NULL DEFAULT 0,
      ls_order_id     TEXT,
      reviewed_by     TEXT,
      reviewed_at     INTEGER,
      created_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS installs (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL,
      subscription_id     TEXT NOT NULL,
      host_type           TEXT NOT NULL,
      device_id           TEXT NOT NULL,
      host_meta           TEXT,
      installed_at        INTEGER NOT NULL,
      last_seen_at        INTEGER NOT NULL,
      UNIQUE (user_id, host_type, device_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT,
      event       TEXT NOT NULL,
      data        TEXT,
      created_at  INTEGER NOT NULL
    );

    -- ── Usage ────────────────────────────────────────────────────────────
    -- One row per usage report sent by a licensed CLI. Aggregate rows, not
    -- per-call: the CLIs send a bounded summary (tokens processed, calls
    -- guarded) after a scan / challenge / measure, never the hot path. The
    -- month column (YYYY-MM, UTC) makes "what did we use this month" a
    -- single indexed range scan, and makes the monthly budget roll over
    -- without any cleanup job.
    CREATE TABLE IF NOT EXISTS usage (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      tool        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      tokens      INTEGER NOT NULL DEFAULT 0,
      calls       INTEGER NOT NULL DEFAULT 0,
      month       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage(user_id, month);
    -- The accumulate key: one row per (user, month, tool, kind). Unique so a
    -- concurrent report can never create a second row — recordUsage upserts
    -- on this, atomically.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_accumulate ON usage(user_id, month, tool, kind);
    CREATE INDEX IF NOT EXISTS idx_installs_user ON installs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_events(user_id, created_at DESC);

    -- ── Beta licenses ────────────────────────────────────────────────────
    -- A standalone trial key for a named external recipient (no waitlist
    -- account needed — this is for handing a zip to someone directly). The
    -- key is a signed JWT so a live server outage doesn't leave the tool
    -- with no answer, but expiry/limit/revocation are enforced from this
    -- table, not the token alone, so a mint can be revoked after the fact.
    CREATE TABLE IF NOT EXISTS beta_licenses (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      daily_limit  INTEGER NOT NULL,
      issued_at    INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      revoked_at   INTEGER
    );

    -- One row per (license, UTC day) actually used. Only rows for days with
    -- at least one call exist — no pre-allocation, no cleanup job, and the
    -- day boundary is exactly "today's row doesn't exist yet" rather than a
    -- reset timer to get right.
    CREATE TABLE IF NOT EXISTS beta_usage (
      license_id  TEXT NOT NULL,
      day         TEXT NOT NULL,
      count       INTEGER NOT NULL DEFAULT 0,
      UNIQUE (license_id, day),
      FOREIGN KEY (license_id) REFERENCES beta_licenses(id)
    );

    CREATE INDEX IF NOT EXISTS idx_beta_usage_license_day ON beta_usage(license_id, day);

    -- ── Subscription license pool ───────────────────────────────────────
    -- A fixed pool of pre-generated CLI unlock codes for the manual-sale
    -- model: a customer pays outside this system (a call, a bank transfer),
    -- and an admin hands them one of these codes and flips it to "taken" by
    -- hand — status is never inferred from usage, only set by an admin
    -- action, because the payment itself never touches this database.
    CREATE TABLE IF NOT EXISTS subscription_licenses (
      id          TEXT PRIMARY KEY,
      license_key TEXT UNIQUE NOT NULL,
      status      TEXT NOT NULL DEFAULT 'not_taken',
      label       TEXT,
      created_at  INTEGER NOT NULL,
      taken_at    INTEGER,
      expires_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sub_licenses_status ON subscription_licenses(status);

    -- ── Firebase signups ─────────────────────────────────────────────────
    -- One row per verified Firebase account (email/password or Google) that
    -- has completed signup. uid is Firebase's own account id — unique by
    -- construction, so re-completing signup for an already-issued account
    -- returns the existing license instead of draining another pool slot.
    -- This table is also what makes a signup visible to an admin, since
    -- nothing here goes through a human hand until this point.
    CREATE TABLE IF NOT EXISTS firebase_signups (
      uid          TEXT PRIMARY KEY,
      email        TEXT NOT NULL,
      name         TEXT NOT NULL,
      provider     TEXT NOT NULL,
      license_id   TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_firebase_signups_created ON firebase_signups(created_at DESC);
  `);

  // Added after subscription_licenses first shipped — ALTER TABLE ADD COLUMN,
  // not a fresh CREATE, so an already-migrated DB must not error on restart.
  // Set the first time a real CLI (not the redeem web page) validates this
  // key; the redeem page uses this to know when to stop showing onboarding
  // and switch to the account/status view.
  try {
    db.exec("ALTER TABLE subscription_licenses ADD COLUMN first_checkin_at INTEGER");
  } catch (err) {
    if (!(err instanceof Error) || !/duplicate column/i.test(err.message)) throw err;
  }
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: PlanId;
  billing: "monthly" | "annual";
  status: "active" | "locked";
  ls_subscription_id: string | null;
  license_key: string | null;
  addon_connections: number;
  started_at: number;
  expires_at: number;
  auto_renew: number;
  locked_at: number | null;
  created_at: number;
}

export type WaitlistStatus = "pending" | "paid" | "approved" | "rejected";

export interface WaitlistRow {
  id: string;
  name: string;
  organisation: string;
  work_email: string;
  phone: string;
  fleet_size: string | null;
  note: string | null;
  status: WaitlistStatus;
  deposit_cents: number;
  ls_order_id: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

export interface InstallRow {
  id: string;
  user_id: string;
  subscription_id: string;
  host_type: "claude-desktop" | "claude-code" | "chatgpt";
  device_id: string;
  host_meta: string | null;
  installed_at: number;
  last_seen_at: number;
}

export interface UsageRow {
  id: string;
  user_id: string;
  tool: "brake" | "redteam" | "thrift";
  kind: string;
  tokens: number;
  calls: number;
  month: string;
  created_at: number;
}
