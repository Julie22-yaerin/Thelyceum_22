/**
 * Session Persistence — The Lyceum
 *
 * Stores task onboarding sessions in Firestore so users don't lose their
 * workspace configuration when they clear localStorage or switch devices.
 *
 * Each session is owned by a license key and contains:
 *   - The tasks selected during onboarding
 *   - AI role assignments per task
 *   - Dependency graph between tasks
 *   - Human + AI outputs as they're produced
 *
 * This complements the Zustand persist (localStorage) layer — the server
 * copy is the authoritative source across devices, while localStorage
 * keeps the UI fast on page loads.
 */

import { getDb } from "./firestore.js";
import type {
  TaskSessionData,
  SessionTaskData,
} from "./sessionTypes.js";

const collection = () => getDb().collection("sessions");

// ── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Create a new session owned by the given license key.
 * Returns the created session with its Firestore-generated id.
 */
export async function createSession(params: {
  licenseKey: string;
  name: string;
  tasks: SessionTaskData[];
}): Promise<TaskSessionData> {
  const ref = collection().doc();
  const session: TaskSessionData = {
    id: ref.id,
    licenseKey: params.licenseKey,
    name: params.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    confirmed: false,
    active: false,
    activeTaskId: null,
    tasks: params.tasks,
  };
  await ref.set(session);
  return session;
}

/**
 * Confirm a session — marks it as active and ready for the workspace.
 */
export async function confirmSession(sessionId: string, licenseKey: string): Promise<TaskSessionData | null> {
  const ref = collection().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as TaskSessionData;
  if (data.licenseKey !== licenseKey) return null;

  const updated: Partial<TaskSessionData> = {
    confirmed: true,
    active: true,
    updatedAt: Date.now(),
  };
  await ref.update(updated);
  return { ...data, ...updated } as TaskSessionData;
}

/**
 * Update a session's tasks (after human output, AI output, status changes, etc.).
 * Only the owner (licenseKey) can update.
 */
export async function updateSessionTasks(
  sessionId: string,
  licenseKey: string,
  tasks: SessionTaskData[],
): Promise<TaskSessionData | null> {
  const ref = collection().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as TaskSessionData;
  if (data.licenseKey !== licenseKey) return null;

  const updated: Partial<TaskSessionData> = {
    tasks,
    updatedAt: Date.now(),
  };
  await ref.update(updated);
  return { ...data, ...updated, tasks } as TaskSessionData;
}

/**
 * Update session metadata (activeTaskId, active flag, autoAnswerAuditLog, etc.).
 */
export async function updateSessionMeta(
  sessionId: string,
  licenseKey: string,
  meta: Partial<Pick<TaskSessionData, "activeTaskId" | "active" | "name" | "autoAnswerAuditLog">>,
): Promise<TaskSessionData | null> {
  const ref = collection().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as TaskSessionData;
  if (data.licenseKey !== licenseKey) return null;

  const updated = { ...meta, updatedAt: Date.now() };
  await ref.update(updated);
  return { ...data, ...updated } as TaskSessionData;
}

/**
 * Get a single session by id, only if owned by the given license key.
 * Returns null if not found or owned by a different key.
 */
export async function getSession(sessionId: string, licenseKey: string): Promise<TaskSessionData | null> {
  const snap = await collection().doc(sessionId).get();
  if (!snap.exists) return null;
  const data = snap.data() as TaskSessionData;
  return data.licenseKey === licenseKey ? data : null;
}

/**
 * List all sessions for a license key, newest first.
 */
export async function listSessions(licenseKey: string, limit = 50): Promise<TaskSessionData[]> {
  const snap = await collection()
    .where("licenseKey", "==", licenseKey)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as TaskSessionData);
}

/**
 * Delete a session, only if owned by the given license key.
 * Returns true if deleted, false if not found or not owned.
 */
export async function deleteSession(sessionId: string, licenseKey: string): Promise<boolean> {
  const ref = collection().doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() as TaskSessionData;
  if (data.licenseKey !== licenseKey) return false;
  await ref.delete();
  return true;
}
