/**
 * Admin authentication.
 *
 * ── Why a license key and not a password ────────────────────────────────────
 * The operator asked for admin access via their existing license key, and that
 * is a reasonable ergonomic: it is a credential they already have, already
 * store, and already treat as secret. There is no second password to lose.
 *
 * ── What that costs, and what is done about it ──────────────────────────────
 * It also means a customer's license key and an admin credential are the same
 * *kind* of string, so a bug that leaks one leaks the other. Three things
 * follow from that, and none of them are optional:
 *
 *   1. Admin keys live in `LYCEUM_ADMIN_KEYS`, not in the database. A key
 *      being in the subscriptions table never grants admin — otherwise a SQL
 *      injection or a leaked backup is an admin takeover, and buying a licence
 *      would be one step from the console.
 *   2. Comparison is timing-safe. An admin check that leaks its answer through
 *      response time is a check that can be brute-forced offline.
 *   3. Every admin action is written to the audit log with the key's
 *      fingerprint — never the key itself. "Who approved this waitlist entry"
 *      has to be answerable, and the answer must not itself be a credential.
 */

import crypto from "node:crypto";
import type { DbHandle } from "./db.js";

/**
 * A short, stable, non-reversible label for a key.
 *
 * Used everywhere an admin identity is recorded. Twelve hex characters is
 * enough to tell two admins apart in a log and far too little to reconstruct
 * the key from.
 */
export function fingerprint(key: string): string {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 12);
}

function configuredAdminKeys(): string[] {
  return (process.env.LYCEUM_ADMIN_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export interface AdminIdentity {
  fingerprint: string;
}

/**
 * Resolve a bearer credential to an admin, or null.
 *
 * Every configured key is compared even after a match is found. Returning
 * early on the first hit would make the response time depend on which admin
 * you are, which is a small leak but a free one to avoid.
 */
export function authenticateAdmin(presented: string | undefined): AdminIdentity | null {
  if (!presented) return null;
  const keys = configuredAdminKeys();
  if (keys.length === 0) return null;

  const presentedBuf = Buffer.from(presented, "utf8");
  let matched = false;
  for (const key of keys) {
    const keyBuf = Buffer.from(key, "utf8");
    // timingSafeEqual throws on length mismatch, so the length check has to
    // come first — but it means length is observable. That is acceptable:
    // the keys are long random strings and length alone reveals nothing
    // useful about their contents.
    if (keyBuf.length === presentedBuf.length && crypto.timingSafeEqual(keyBuf, presentedBuf)) {
      matched = true;
    }
  }
  return matched ? { fingerprint: fingerprint(presented) } : null;
}

/** True when no admin key is configured — the console is then unreachable. */
export function adminConfigured(): boolean {
  return configuredAdminKeys().length > 0;
}

/**
 * Dev-token check for the news-publishing endpoint.
 *
 * Deliberately a separate credential from `LYCEUM_ADMIN_KEYS`: publishing a
 * benchmark update is a narrower, more automatable act (a CI job can hold
 * this token) than full admin-console access (approving waitlist entries,
 * reading the audit log), so it doesn't get the same key. Same timing-safe
 * comparison, same "env var, never the database" rule.
 */
export function authenticateDevToken(presented: string | undefined): boolean {
  if (!presented) return false;
  const token = (process.env.LYCEUM_DEV_TOKEN ?? "").trim();
  if (!token) return false;
  const presentedBuf = Buffer.from(presented, "utf8");
  const tokenBuf = Buffer.from(token, "utf8");
  return tokenBuf.length === presentedBuf.length && crypto.timingSafeEqual(tokenBuf, presentedBuf);
}

/** True when no dev token is configured — the publish endpoint is then unreachable. */
export function devTokenConfigured(): boolean {
  return (process.env.LYCEUM_DEV_TOKEN ?? "").trim().length > 0;
}

/**
 * Record an admin action.
 *
 * The fingerprint identifies the actor; the key never touches the log. An
 * audit trail that stores the credential it is auditing is a credential
 * store with extra steps.
 */
export function recordAdminAction(
  db: DbHandle,
  identity: AdminIdentity,
  event: string,
  data: Record<string, unknown> = {}
): void {
  db.raw
    .prepare("INSERT INTO audit_events (user_id, event, data, created_at) VALUES (?, ?, ?, ?)")
    .run(
      `admin:${identity.fingerprint}`,
      event,
      JSON.stringify(data),
      Date.now()
    );
}

export interface AdminAuditEntry {
  id: number;
  user_id: string | null;
  event: string;
  data: string | null;
  created_at: number;
}

export function recentAdminActions(db: DbHandle, limit = 50): AdminAuditEntry[] {
  return db.raw
    .prepare(
      "SELECT * FROM audit_events WHERE user_id LIKE 'admin:%' ORDER BY created_at DESC LIMIT ?"
    )
    .all(Math.min(Math.max(1, limit), 500)) as unknown as AdminAuditEntry[];
}
