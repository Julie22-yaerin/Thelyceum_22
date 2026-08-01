/**
 * AI host installs (devices).
 *
 * Each `brake install <host>` on a unique device counts as one connection.
 * The server enforces the per-plan cap (3 for Starter, 5 for Pro). Re-installing
 * the same host on the same device is idempotent — the existing row's
 * last_seen_at is updated.
 */

import { randomUUID } from "node:crypto";
import type { DbHandle, InstallRow } from "./db.js";
import { getPlan } from "./plans.js";
import type { SubscriptionRow } from "./db.js";

export type HostType = "claude-desktop" | "claude-code" | "chatgpt";

const ALL_HOSTS: HostType[] = ["claude-desktop", "claude-code", "chatgpt"];

export function isHostType(s: string): s is HostType {
  return (ALL_HOSTS as string[]).includes(s);
}

export class DeviceError extends Error {
  constructor(public code: "limit_reached" | "no_active_subscription" | "invalid_host", message: string) {
    super(message);
  }
}

export interface RegisterInput {
  userId: string;
  hostType: HostType;
  deviceId: string;
  hostMeta?: Record<string, unknown>;
}

export interface RegisterResult {
  install: InstallRow;
  /** Number of installs this user has after this registration. */
  total: number;
  limit: number;
}

export function registerInstall(db: DbHandle, input: RegisterInput): RegisterResult {
  if (!isHostType(input.hostType)) {
    throw new DeviceError("invalid_host", `unknown host: ${input.hostType}`);
  }

  const sub = db.raw
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(input.userId) as SubscriptionRow | undefined;

  const now = Date.now();
  if (!sub || sub.status !== "active" || (sub.expires_at < now && sub.auto_renew === 0)) {
    throw new DeviceError("no_active_subscription", "no active subscription; visit brake dashboard to renew");
  }

  const plan = getPlan(sub.plan);
  const existing = db.raw
    .prepare("SELECT * FROM installs WHERE user_id = ? AND host_type = ? AND device_id = ?")
    .get(input.userId, input.hostType, input.deviceId) as InstallRow | undefined;

  if (existing) {
    db.raw
      .prepare("UPDATE installs SET last_seen_at = ?, host_meta = ? WHERE id = ?")
      .run(now, JSON.stringify(input.hostMeta ?? {}), existing.id);
    const total = (db.raw.prepare("SELECT COUNT(*) as c FROM installs WHERE user_id = ?").get(input.userId) as { c: number }).c;
    return {
      install: { ...existing, last_seen_at: now, host_meta: JSON.stringify(input.hostMeta ?? {}) },
      total,
      limit: plan.aiConnections,
    };
  }

  const count = (db.raw
    .prepare("SELECT COUNT(*) as c FROM installs WHERE user_id = ?")
    .get(input.userId) as { c: number }).c;

  if (count >= plan.aiConnections) {
    throw new DeviceError(
      "limit_reached",
      `connection limit reached (${count}/${plan.aiConnections}). Your ${plan.name} plan supports ${plan.aiConnections} AI connections. Upgrade to Pro for 5.`
    );
  }

  const id = randomUUID();
  db.raw
    .prepare(
      `INSERT INTO installs (id, user_id, subscription_id, host_type, device_id, host_meta, installed_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.userId,
      sub.id,
      input.hostType,
      input.deviceId,
      JSON.stringify(input.hostMeta ?? {}),
      now,
      now
    );

  return {
    install: {
      id,
      user_id: input.userId,
      subscription_id: sub.id,
      host_type: input.hostType,
      device_id: input.deviceId,
      host_meta: JSON.stringify(input.hostMeta ?? {}),
      installed_at: now,
      last_seen_at: now,
    },
    total: count + 1,
    limit: plan.aiConnections,
  };
}

export function listInstalls(db: DbHandle, userId: string): InstallRow[] {
  return db.raw
    .prepare("SELECT * FROM installs WHERE user_id = ? ORDER BY last_seen_at DESC")
    .all(userId) as unknown as InstallRow[];
}

export function unregisterInstall(db: DbHandle, userId: string, installId: string): boolean {
  const result = db.raw
    .prepare("DELETE FROM installs WHERE id = ? AND user_id = ?")
    .run(installId, userId);
  return result.changes > 0;
}
