/**
 * Per-workspace state that must survive a restart and be shared across
 * instances.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Several things were held in module-level Maps inside index.ts: the healing
 * policy, the escalation policy, the active red alert, integration
 * connections, cloud config. That works on one process and breaks silently on
 * two, which is the worst kind of breakage because nothing errors:
 *
 *   - An operator turns OFF autonomous healing. Their request lands on
 *     instance A. Instance B still has it on and keeps applying patches.
 *   - A red alert is raised on instance A. The operator's browser polls
 *     instance B, sees no alert, and never learns an agent was stopped.
 *   - Someone connects Gmail, then a deploy rolls the process and the
 *     connection is gone with no message.
 *
 * For a product whose entire claim is "the controls hold", a control that
 * depends on which instance you happened to reach is not a control.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 * One document per workspace, keyed by license key, holding a small set of
 * named slots. Deliberately a single document rather than a collection per
 * concern: these are all small, always read together by the war room, and a
 * single read is both faster and atomic across them.
 */

import { getDb } from "./firestore.js";

/** Everything a workspace can persist. Add slots here, not ad-hoc collections. */
export interface WorkspaceState {
  licenseKey: string;
  /** Autonomous healing settings — see server/healing/riskAssessment.ts. */
  healingPolicy?: unknown;
  /** Escalation thresholds and the officer permission. */
  escalationPolicy?: unknown;
  /** The live red alert, if one is raised. Null once cleared. */
  activeAlert?: unknown;
  /** Connected integrations, keyed by provider id. */
  connections?: Record<string, unknown>;
  /** Bring-your-own-cloud configuration. */
  cloudConfig?: unknown;
  updatedAt: number;
}

const collection = () => getDb().collection("workspaceState");

export async function readState(licenseKey: string): Promise<WorkspaceState | null> {
  const snap = await collection().doc(licenseKey).get();
  return snap.exists ? (snap.data() as WorkspaceState) : null;
}

/**
 * Read one slot with a fallback.
 *
 * The fallback is returned on a missing document AND on a missing slot, so a
 * workspace that has never touched a setting behaves identically to one that
 * has never existed — no special-casing at the call site.
 */
export async function readSlot<T>(
  licenseKey: string,
  slot: keyof Omit<WorkspaceState, "licenseKey" | "updatedAt">,
  fallback: T
): Promise<T> {
  const state = await readState(licenseKey);
  const value = state?.[slot];
  return (value === undefined || value === null ? fallback : value) as T;
}

/**
 * Write one slot, leaving the others alone.
 *
 * `merge: true` matters: two concurrent writes to different slots must not
 * clobber each other, which a whole-document set would do.
 */
export async function writeSlot(
  licenseKey: string,
  slot: keyof Omit<WorkspaceState, "licenseKey" | "updatedAt">,
  value: unknown
): Promise<void> {
  await collection()
    .doc(licenseKey)
    .set({ licenseKey, [slot]: value, updatedAt: Date.now() }, { merge: true });
}

/** Clear a slot. Distinct from writing null so "unset" reads as the fallback. */
export async function clearSlot(
  licenseKey: string,
  slot: keyof Omit<WorkspaceState, "licenseKey" | "updatedAt">
): Promise<void> {
  await writeSlot(licenseKey, slot, null);
}

// ── Connections ──────────────────────────────────────────────────────────────

export interface StoredConnection {
  provider: string;
  connectedAs: string;
  connectedAt: number;
  mode: "real" | "sandbox";
  /**
   * Access token, when there is one.
   *
   * Stored server-side only and never returned by any read API — the
   * integrations endpoint projects a connection down to provider, display name
   * and mode before it leaves the server. A token that reaches the browser is
   * a token in the DOM, in memory, and in any screenshot the operator takes.
   */
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export async function listConnections(licenseKey: string): Promise<Record<string, StoredConnection>> {
  return readSlot<Record<string, StoredConnection>>(licenseKey, "connections", {});
}

export async function saveConnection(
  licenseKey: string,
  providerId: string,
  connection: StoredConnection
): Promise<void> {
  const existing = await listConnections(licenseKey);
  await writeSlot(licenseKey, "connections", { ...existing, [providerId]: connection });
}

export async function removeConnection(licenseKey: string, providerId: string): Promise<void> {
  const existing = await listConnections(licenseKey);
  delete existing[providerId];
  await writeSlot(licenseKey, "connections", existing);
}

/**
 * A connection as it is safe to send to a browser.
 *
 * Enforced by construction rather than by remembering to delete fields at each
 * call site: this returns a new object with only the safe keys, so a token
 * added to StoredConnection later cannot leak by omission.
 */
export function publicConnection(c: StoredConnection): {
  provider: string;
  connectedAs: string;
  connectedAt: number;
  mode: "real" | "sandbox";
} {
  return {
    provider: c.provider,
    connectedAs: c.connectedAs,
    connectedAt: c.connectedAt,
    mode: c.mode,
  };
}
