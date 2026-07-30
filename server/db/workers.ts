import crypto from "crypto";
import { getDb } from "./firestore.js";

/**
 * The AI roster.
 *
 * A roster entry is not a description of an AI — it is the AI's identity in
 * this workspace. Each one carries its own MCP token, which is what turns a
 * name on a list into something that can actually connect, see the steps
 * assigned to it, and report what it did. Without the token the roster is
 * decoration; with it, the roster is how work reaches the AI.
 *
 * The token is per-worker rather than per-account on purpose: it means a
 * connected client can be told exactly which steps are its own, revoking one
 * AI's access doesn't disturb the others, and every token spent is
 * attributable to a specific worker instead of the whole company.
 */

export interface Worker {
  id: string;
  licenseKey: string;
  name: string;
  /** What it does, in the customer's words. */
  role: string;
  /** Department (WorkRole id) it belongs to. */
  departmentId: string;
  departmentName: string;
  model: string;
  /** Credential that appears in the MCP URL. Rotatable, revocable. */
  mcpToken: string;
  tokensUsed: number;
  stepsCompleted: number;
  lastSeenAt: number | null;
  revokedAt?: number;
  createdAt: number;
}

const collection = () => getDb().collection("workers");

export function generateWorkerToken(): string {
  return `lyw_${crypto.randomBytes(18).toString("base64url")}`;
}

export async function createWorker(params: {
  licenseKey: string;
  name: string;
  role: string;
  departmentId: string;
  departmentName: string;
  model: string;
}): Promise<Worker> {
  const ref = collection().doc();
  const worker: Worker = {
    id: ref.id,
    licenseKey: params.licenseKey,
    name: params.name,
    role: params.role,
    departmentId: params.departmentId,
    departmentName: params.departmentName,
    model: params.model,
    mcpToken: generateWorkerToken(),
    tokensUsed: 0,
    stepsCompleted: 0,
    lastSeenAt: null,
    createdAt: Date.now(),
  };
  await ref.set(worker);
  return worker;
}

export async function listWorkers(licenseKey: string): Promise<Worker[]> {
  const snap = await collection().where("licenseKey", "==", licenseKey).get();
  return snap.docs
    .map((d) => d.data() as Worker)
    .filter((w) => !w.revokedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Resolve the token that arrived in an MCP URL back to its worker. */
export async function resolveWorkerToken(token: string): Promise<Worker | null> {
  if (!token) return null;
  const snap = await collection().where("mcpToken", "==", token).get();
  // Check the row directly rather than trusting `snap.empty` — this is the
  // gate every connected AI passes through, so it must fail closed even if
  // the driver underneath doesn't populate that flag.
  const doc = snap.docs?.[0];
  if (!doc) return null;
  const worker = doc.data() as Worker | undefined;
  if (!worker || worker.revokedAt) return null;
  return worker;
}

export async function touchWorker(workerId: string): Promise<void> {
  // Liveness only — a failure here must never break the caller's request.
  await collection()
    .doc(workerId)
    .set({ lastSeenAt: Date.now() }, { merge: true })
    .catch(() => {});
}

export async function recordWorkerUsage(
  workerId: string,
  patch: { tokens?: number; stepsCompleted?: number }
): Promise<void> {
  const ref = collection().doc(workerId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const current = snap.data() as Worker;
  await ref.set(
    {
      tokensUsed: current.tokensUsed + (patch.tokens ?? 0),
      stepsCompleted: current.stepsCompleted + (patch.stepsCompleted ?? 0),
      lastSeenAt: Date.now(),
    },
    { merge: true }
  );
}

export async function revokeWorker(licenseKey: string, workerId: string): Promise<boolean> {
  const ref = collection().doc(workerId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as Worker).licenseKey !== licenseKey) return false;
  await ref.set({ revokedAt: Date.now() }, { merge: true });
  return true;
}

/** Rotate a leaked token without losing the worker's history. */
export async function rotateWorkerToken(
  licenseKey: string,
  workerId: string
): Promise<string | null> {
  const ref = collection().doc(workerId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as Worker).licenseKey !== licenseKey) return null;
  const mcpToken = generateWorkerToken();
  await ref.set({ mcpToken }, { merge: true });
  return mcpToken;
}
