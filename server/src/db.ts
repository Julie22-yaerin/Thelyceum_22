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
      stripe_customer_id      TEXT,
      stripe_subscription_id  TEXT,
      started_at              INTEGER NOT NULL,
      expires_at              INTEGER NOT NULL,
      auto_renew              INTEGER NOT NULL DEFAULT 1,
      locked_at               INTEGER,
      created_at              INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

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

    CREATE INDEX IF NOT EXISTS idx_installs_user ON installs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_events(user_id, created_at DESC);
  `);
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
  plan: "starter" | "pro";
  billing: "monthly" | "annual";
  status: "active" | "locked";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  started_at: number;
  expires_at: number;
  auto_renew: number;
  locked_at: number | null;
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
