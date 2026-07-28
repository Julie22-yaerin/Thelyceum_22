import type { Domain } from "../../client/src/lib/modelConfig.js";
import { deductCredits, InsufficientCreditsError } from "../db/accounts.js";
import { recordTask } from "../db/tasks.js";
import { extractReplyText, proxyToOpenRouter } from "./openrouter.js";

/** Flat credit cost per task — deliberately simple for V1 (not token-metered). */
export const TASK_COST = 10;

export { InsufficientCreditsError };

export interface RunTaskResult {
  taskId: string;
  result: string;
  creditsRemaining: number;
  creditsCost: number;
}

/**
 * Shared "assign a task to a Lyceum AI domain" path used by both the
 * REST API (POST /api/v1/chat) and the MCP `assign_task` tool. Deducts
 * credits before calling the model so a mid-flight failure can't be used to
 * rack up free calls, then records the outcome either way.
 */
export async function runTask(params: {
  licenseKey: string;
  domain: Domain;
  prompt: string;
  source: "api" | "mcp";
}): Promise<RunTaskResult> {
  const { licenseKey, domain, prompt, source } = params;

  // Deduct first — throws InsufficientCreditsError if the balance is too low.
  const creditsRemaining = await deductCredits(licenseKey, TASK_COST);

  try {
    const completion = await proxyToOpenRouter({
      domain,
      messages: [{ role: "user", content: prompt }],
    });
    const result = extractReplyText(completion);

    const task = await recordTask({
      licenseKey,
      domain,
      prompt,
      source,
      status: "completed",
      result,
      creditsCost: TASK_COST,
    });

    return { taskId: task.id, result, creditsRemaining, creditsCost: TASK_COST };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task failed";
    await recordTask({
      licenseKey,
      domain,
      prompt,
      source,
      status: "failed",
      error: message,
      creditsCost: TASK_COST,
    });
    throw err;
  }
}
