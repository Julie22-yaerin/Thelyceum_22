/**
 * Execution Config — Shared Types
 *
 * Controls retry limits, attempt tracking, and human approval workflow
 * for AI task execution (both API model calls and MCP calls).
 *
 * Philosophy:
 * - Max 2 attempts per task (1 initial run + 1 retry on failure)
 * - After 2 failures → notify human with clear error context
 * - Small subtasks (bash, API calls, etc.) can be auto-approved by AI
 *   if the human has pre-approved that permission; otherwise send to human
 * - Prevents infinite retry loops that burn tokens/credits
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** Default max attempts per task */
export const DEFAULT_MAX_ATTEMPTS = 2;

/** Default: small subtasks require human approval for retry */
export const DEFAULT_AUTO_APPROVE_SUBTASKS = false;

// ── Types ────────────────────────────────────────────────────────────────────

export type AttemptStatus = "running" | "completed" | "failed";

export type HumanApprovalStatus = "pending" | "approved" | "rejected" | "not_required";

/**
 * Configuration for a single task execution.
 * Can be set per-domain, per-agent-role, or globally.
 */
export interface ExecutionConfig {
  /** Max times this task can be attempted (default 2 = 1 fail + 1 retry) */
  maxAttempts: number;
  /**
   * If true, AI can auto-approve retries for small subtasks (bash, API
   * calls, etc.) without waiting for human approval.
   * If false, every failure sends a manual approval request to the human.
   */
  autoApproveSubtasks: boolean;
}

/**
 * Record of a single attempt to execute a task.
 * Stored alongside the task in Firestore.
 */
export interface TaskAttempt {
  attemptNumber: number;
  status: AttemptStatus;
  /** ISO timestamp when the attempt started */
  startedAt: string;
  /** ISO timestamp when the attempt completed/failed */
  completedAt?: string;
  /** Error message if failed — must be clear, concise, human-readable */
  error?: string;
  /** Optional detailed error context (stack traces, etc.) */
  errorDetail?: string;
  /** The model endpoint that was called (for debugging) */
  endpoint?: string;
  /** Credits consumed by this attempt */
  creditsCost: number;
}

/**
 * A request sent to a human for approval when an AI task fails
 * and requires manual intervention to retry.
 */
export interface HumanApprovalRequest {
  /** Unique ID for this request */
  id: string;
  /** The task that failed */
  taskId: string;
  /** Which attempt failed */
  failedAttemptNumber: number;
  /** Human-readable, concise error description */
  errorContext: string;
  /** What action the AI wants to retry */
  requestedAction: string;
  /** ISO timestamp when the request was created */
  requestedAt: string;
  /** Current status of this approval request */
  status: HumanApprovalStatus;
  /** ISO timestamp when the human responded */
  respondedAt?: string;
  /** Human's notes (optional) */
  humanNotes?: string;
  /** Whether the task is small/subtask (bash, API call) — eligible for auto-approval */
  isSubtask: boolean;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  autoApproveSubtasks: DEFAULT_AUTO_APPROVE_SUBTASKS,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine whether a retry can proceed without human approval.
 * Small subtasks (bash, API calls) can be auto-approved if the human has
 * pre-configured `autoApproveSubtasks = true`.
 */
export function canAutoRetry(
  config: ExecutionConfig,
  attempts: TaskAttempt[],
  isSubtask: boolean,
): boolean {
  // Never auto-retry if we've already hit the max
  if (attempts.length >= config.maxAttempts) return false;

  // If it's a subtask and auto-approval is enabled, we can retry
  if (isSubtask && config.autoApproveSubtasks) return true;

  // All other cases require human approval
  return false;
}

/**
 * Build a concise, human-readable error context string
 * from an error and the task details.
 */
export function formatErrorContext(
  error: string,
  endpoint: string,
  attemptNumber: number,
): string {
  const lines: string[] = [
    `❌ Attempt ${attemptNumber} failed at ${endpoint}`,
    `   Error: ${error}`,
  ];
  return lines.join("\n");
}
