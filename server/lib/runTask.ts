import type { Domain } from "../../client/src/lib/modelConfig.js";
import { deductCredits, InsufficientCreditsError } from "../db/accounts.js";
import { recordTask, updateTaskAttempt } from "../db/tasks.js";
import { extractReplyText, proxyToOpenRouter } from "./openrouter.js";
import {
  DEFAULT_EXECUTION_CONFIG,
  canAutoRetry,
  formatErrorContext,
  type TaskAttempt,
  type HumanApprovalRequest,
  type ExecutionConfig,
} from "./executionConfig.js";

/** Flat credit cost per task — deliberately simple for V1 (not token-metered). */
export const TASK_COST = 10;

export { InsufficientCreditsError };

export interface RunTaskResult {
  taskId: string;
  result: string;
  creditsRemaining: number;
  creditsCost: number;
  /** Number of attempts so far (0-based) */
  attemptCount: number;
  /** If true, the task has failed and needs human approval to retry */
  needsHumanApproval: boolean;
  /** Pending human approval request, if any */
  humanApprovalRequest?: HumanApprovalRequest;
}

/**
 * Shared "assign a task to a Lyceum AI domain" path used by both the
 * REST API (POST /api/v1/chat) and the MCP `assign_task` tool. Deducts
 * credits before calling the model so a mid-flight failure can't be used to
 * rack up free calls, then records the outcome either way.
 *
 * Retry-limit enforcement:
 * - Max `executionConfig.maxAttempts` attempts (default 2 = 1 initial + 1 retry)
 * - On failure: if attempts < max, notifies human for approval
 * - On approval: caller should call runTask again with the previous taskId
 * - After max attempts exhausted: marks task as permanently failed
 */
export async function runTask(params: {
  licenseKey: string;
  domain: Domain;
  prompt: string;
  source: "api" | "mcp";
  /** If retrying, pass the existing task ID so we append attempts */
  existingTaskId?: string;
  /** Override execution config (defaults to 2 max attempts, no auto-approve) */
  executionConfig?: ExecutionConfig;
}): Promise<RunTaskResult> {
  const { licenseKey, domain, prompt, source, existingTaskId, executionConfig } = params;
  const config = executionConfig ?? DEFAULT_EXECUTION_CONFIG;

  // Deduct first — throws InsufficientCreditsError if the balance is too low.
  const creditsRemaining = await deductCredits(licenseKey, TASK_COST);

  // Determine the attempt number based on existing attempts
  let existingAttemptCount = 0;
  if (existingTaskId) {
    // We need to know the current count — fetch the task first
    const { getTask } = await import("../db/tasks.js");
    const existingTask = await getTask(existingTaskId, licenseKey);
    existingAttemptCount = existingTask?.attempts.length ?? 0;
  }

  const now = new Date().toISOString();
  const attemptNumber = existingAttemptCount;
  const attempt: TaskAttempt = {
    attemptNumber,
    status: "running",
    startedAt: now,
    creditsCost: TASK_COST,
    endpoint: `openrouter:${domain}`,
  };

  let taskId = existingTaskId ?? "";

  try {
    const completion = await proxyToOpenRouter({
      domain,
      messages: [{ role: "user", content: prompt }],
    });
    const result = extractReplyText(completion);

    // Record successful attempt
    attempt.status = "completed";
    attempt.completedAt = new Date().toISOString();

    if (existingTaskId) {
      // Append to existing task
      const existing = await updateTaskAttempt(existingTaskId, licenseKey, {
        status: "completed",
        result,
        newAttempts: [attempt],
      });
      taskId = existing?.id ?? existingTaskId;
    } else {
      const task = await recordTask({
        licenseKey,
        domain,
        prompt,
        source,
        status: "completed",
        result,
        creditsCost: TASK_COST,
        attemptCount: attemptNumber,
        maxAttempts: config.maxAttempts,
        attempts: [attempt],
      });
      taskId = task.id;
    }

    return {
      taskId,
      result,
      creditsRemaining,
      creditsCost: TASK_COST,
      attemptCount: attemptNumber,
      needsHumanApproval: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task failed";
    const endpoint = `openrouter:${domain}`;
    const errorContext = formatErrorContext(message, endpoint, existingAttemptCount + 1);

    // Record failed attempt
    attempt.status = "failed";
    attempt.completedAt = new Date().toISOString();
    attempt.error = message;
    attempt.errorDetail = err instanceof Error ? err.stack : undefined;

    if (existingTaskId) {
      // Count existing attempts
      const existing = await updateTaskAttempt(existingTaskId, licenseKey, {
        status: "failed",
        error: message,
        newAttempts: [attempt],
      });
      if (existing) {
        const totalAttempts = existing.attempts.length;


        // Check if we can retry or need human approval
        if (totalAttempts >= config.maxAttempts) {
          // Max attempts exhausted — mark as permanently failed
          await updateTaskAttempt(existingTaskId, licenseKey, {
            status: "failed",
            error: `Max attempts (${config.maxAttempts}) exhausted. Last error: ${message}`,
          });
          throw new MaxAttemptsError(existingTaskId, config.maxAttempts, message);
        }

        // Determine if auto-retry or human approval needed
        const isSubtask = source === "api" && prompt.length < 200;
        if (canAutoRetry(config, existing.attempts, isSubtask)) {
          // Auto-retry — caller should retry
          throw new RetryableError(existingTaskId, message, totalAttempts);
        }

        // Human approval needed
        const approvalRequest: HumanApprovalRequest = {
          id: `approval-${existingTaskId}-${totalAttempts}`,
          taskId: existingTaskId,
          failedAttemptNumber: totalAttempts,
          errorContext,
          requestedAction: `Retry task "${prompt.slice(0, 80)}…" on ${domain}`,
          requestedAt: new Date().toISOString(),
          status: "pending",
          isSubtask,
        };

        await updateTaskAttempt(existingTaskId, licenseKey, {
          status: "awaiting_approval",
          humanApprovalRequest: approvalRequest,
        });

        throw new NeedsHumanApprovalError(existingTaskId, message, approvalRequest);
      }
    }

    // Fresh task, first attempt failed
    const task = await recordTask({
      licenseKey,
      domain,
      prompt,
      source,
      status: "failed",
      error: message,
      creditsCost: TASK_COST,
      attemptCount: 0,
      maxAttempts: config.maxAttempts,
      attempts: [attempt],
      autoApproveSubtasks: config.autoApproveSubtasks,
    });
    taskId = task.id;

    // First failure — if we have retries left, mark as needing human approval
    if (config.maxAttempts > 1) {
      const isSubtask = source === "api" && prompt.length < 200;
      const approvalRequest: HumanApprovalRequest = {
        id: `approval-${task.id}-0`,
        taskId: task.id,
        failedAttemptNumber: 0,
        errorContext,
        requestedAction: `Retry task "${prompt.slice(0, 80)}…" on ${domain}`,
        requestedAt: new Date().toISOString(),
        status: "pending",
        isSubtask,
      };

      await updateTaskAttempt(task.id, licenseKey, {
        status: "awaiting_approval",
        humanApprovalRequest: approvalRequest,
      });

      throw new NeedsHumanApprovalError(task.id, message, approvalRequest);
    }

    throw err;
  }
}

// ── Custom Errors ────────────────────────────────────────────────────────────

/** Thrown when max attempts are exhausted and the task is permanently failed. */
export class MaxAttemptsError extends Error {
  constructor(
    public taskId: string,
    public maxAttempts: number,
    public lastError: string,
  ) {
    super(`Max attempts (${maxAttempts}) exhausted. Last error: ${lastError}`);
    this.name = "MaxAttemptsError";
  }
}

/** Thrown when a retry is allowed (auto or manual) and the caller should retry. */
export class RetryableError extends Error {
  constructor(
    public taskId: string,
    public lastError: string,
    public attemptNumber: number,
  ) {
    super(`Attempt ${attemptNumber} failed: ${lastError}. Retry available.`);
    this.name = "RetryableError";
  }
}

/** Thrown when a task fails and requires human approval to retry. */
export class NeedsHumanApprovalError extends Error {
  constructor(
    public taskId: string,
    public lastError: string,
    public approvalRequest: HumanApprovalRequest,
  ) {
    super(`Task failed: ${lastError}. Human approval required for retry.`);
    this.name = "NeedsHumanApprovalError";
  }
}
