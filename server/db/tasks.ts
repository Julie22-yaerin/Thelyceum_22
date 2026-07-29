import { getDb } from "./firestore.js";
import type { TaskAttempt, HumanApprovalRequest, ExecutionConfig } from "../lib/executionConfig.js";
import { DEFAULT_EXECUTION_CONFIG } from "../lib/executionConfig.js";

export interface Task {
  id: string;
  licenseKey: string;
  domain: string;
  prompt: string;
  source: "api" | "mcp";
  status: "completed" | "failed" | "awaiting_approval";
  result?: string;
  error?: string;
  creditsCost: number;
  createdAt: number;
  // ── Retry-limit fields ──────────────────────────────────────────────────
  /** Current attempt number (starts at 0, increments on each run) */
  attemptCount: number;
  /** Max attempts before human must intervene (default 2) */
  maxAttempts: number;
  /** History of all execution attempts */
  attempts: TaskAttempt[];
  /** Whether small subtasks can auto-retry without human approval */
  autoApproveSubtasks: boolean;
  /** Pending human approval request (null if not needed) */
  humanApprovalRequest: HumanApprovalRequest | null;
}

const collection = () => getDb().collection("tasks");

export async function recordTask(params: {
  licenseKey: string;
  domain: string;
  prompt: string;
  source: "api" | "mcp";
  status: "completed" | "failed" | "awaiting_approval";
  result?: string;
  error?: string;
  creditsCost: number;
  attemptCount?: number;
  maxAttempts?: number;
  attempts?: TaskAttempt[];
  autoApproveSubtasks?: boolean;
  humanApprovalRequest?: HumanApprovalRequest | null;
}): Promise<Task> {
  const ref = collection().doc();
  const task: Task = {
    id: ref.id,
    createdAt: Date.now(),
    attemptCount: params.attemptCount ?? 0,
    maxAttempts: params.maxAttempts ?? DEFAULT_EXECUTION_CONFIG.maxAttempts,
    attempts: params.attempts ?? [],
    autoApproveSubtasks: params.autoApproveSubtasks ?? DEFAULT_EXECUTION_CONFIG.autoApproveSubtasks,
    humanApprovalRequest: params.humanApprovalRequest ?? null,
    licenseKey: params.licenseKey,
    domain: params.domain,
    prompt: params.prompt,
    source: params.source,
    status: params.status,
    result: params.result,
    error: params.error,
    creditsCost: params.creditsCost,
  };
  await ref.set(task);
  return task;
}

export async function updateTaskAttempt(
  taskId: string,
  licenseKey: string,
  update: {
    status?: "completed" | "failed" | "awaiting_approval";
    result?: string;
    error?: string;
    attemptCount?: number;
    /** New attempts to APPEND to the existing history */
    newAttempts?: TaskAttempt[];
    humanApprovalRequest?: HumanApprovalRequest | null;
  },
): Promise<Task | null> {
  const ref = collection().doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const existing = snap.data() as Task;
  if (existing.licenseKey !== licenseKey) return null;

  const updated: Task = {
    ...existing,
    status: update.status ?? existing.status,
    result: update.result ?? existing.result,
    error: update.error ?? existing.error,
    attemptCount: update.attemptCount ?? existing.attemptCount,
    humanApprovalRequest: update.humanApprovalRequest !== undefined
      ? update.humanApprovalRequest
      : existing.humanApprovalRequest,
    // Append new attempts to the existing history
    attempts: update.newAttempts
      ? [...existing.attempts, ...update.newAttempts]
      : existing.attempts,
  };
  await ref.set(updated);
  return updated;
}

export async function updateTaskApproval(
  taskId: string,
  licenseKey: string,
  approval: HumanApprovalRequest,
): Promise<Task | null> {
  const ref = collection().doc(taskId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const existing = snap.data() as Task;
  if (existing.licenseKey !== licenseKey) return null;

  const updated: Task = {
    ...existing,
    humanApprovalRequest: approval,
    status: approval.status === "approved" ? existing.status : "awaiting_approval",
  };
  await ref.set(updated);
  return updated;
}

export async function listTasks(licenseKey: string, limit = 20): Promise<Task[]> {
  const snap = await collection()
    .where("licenseKey", "==", licenseKey)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Task);
}

/** Returns null if the task doesn't exist OR belongs to a different account — callers should treat both as "not found". */
export async function getTask(taskId: string, licenseKey: string): Promise<Task | null> {
  const snap = await collection().doc(taskId).get();
  if (!snap.exists) return null;
  const task = snap.data() as Task;
  return task.licenseKey === licenseKey ? task : null;
}
