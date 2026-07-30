/**
 * The Lyceum MCP server — Streamable HTTP transport.
 *
 * This is the production MCP endpoint (POST /api/mcp), built on the official
 * @modelcontextprotocol/sdk so any spec-compliant client (Claude Desktop/
 * Code, Cursor, etc. — either natively or via the `mcp-remote` bridge) can
 * connect to it directly over HTTP. It runs in stateless mode
 * (sessionIdGenerator: undefined): a fresh McpServer + transport is created
 * per request, which is what makes this safe to run on Vercel's serverless
 * functions — there's no in-process session to lose between invocations.
 * All durable state (credits, task history) lives in Firestore, not in the
 * transport.
 *
 * This supersedes the legacy WebSocket server in lyceum-mcp-server.ts,
 * which only works under the standalone Node server (`npm start`) and
 * operates on mock in-memory data — kept for local dev only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type express from "express";
import { z } from "zod";
import { DOMAINS, type Domain } from "../../client/src/lib/modelConfig.js";
import type { Account } from "../db/accounts.js";
import { getTask, listTasks } from "../db/tasks.js";
import { InsufficientCreditsError, MaxAttemptsError, NeedsHumanApprovalError, RetryableError, runTask, TASK_COST, type RunTaskResult } from "../lib/runTask.js";
import type { AuthedRequest } from "../lib/auth.js";
import {
  registerAiRole,
  listAiRoles,
  reportTokens,
  TokenBudgetExceededError,
} from "../db/aiRoles.js";
import { createMission, listMissions, updateStep, progressOf } from "../db/missions.js";

function buildServer(account: Account): McpServer {
  const server = new McpServer({ name: "the-lyceum", version: "1.0.0" });

  server.registerTool(
    "check_quota",
    {
      title: "Check quota",
      description: "Get remaining and total credits for this Lyceum account, and the cost per task.",
    },
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            creditsRemaining: account.creditsRemaining,
            creditsTotal: account.creditsTotal,
            costPerTask: TASK_COST,
            product: account.product,
            organization: account.organization,
          }),
        },
      ],
    })
  );

  server.registerTool(
    "assign_task",
    {
      title: "Assign task",
      description:
        "Assign a task or question to one of the Lyceum AI domains (LAW, FINANCE, TECH, MUSE) and get the result back synchronously. Deducts credits from your account.",
      inputSchema: {
        domain: z
          .enum(DOMAINS as unknown as [string, ...string[]])
          .describe("Which Lyceum AI domain should handle this task: LAW, FINANCE, TECH, or MUSE"),
        prompt: z.string().min(1).describe("The task or question to send to the AI"),
      },
    },
    async ({ domain, prompt }: { domain: string; prompt: string }) => {
      // ── Auto-retry loop (up to 2 attempts) ────────────────────────────
      let lastResult: RunTaskResult | null = null;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await runTask({
            licenseKey: account.licenseKey,
            domain: domain as Domain,
            prompt,
            source: "mcp",
            existingTaskId: lastResult?.taskId,
          });
          lastResult = result;
          break; // success — exit loop
        } catch (err) {
          if (err instanceof RetryableError) {
            // Auto-retry allowed — loop will retry
            continue;
          }
          // Non-retryable error — handle below
          return handleTaskError(err);
        }
      }

      // Loop exhausted without success (RetryableError kept throwing)
      if (!lastResult) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Task failed after 2 attempts. Please try again later." }],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `${lastResult.result}\n\n[task ${lastResult.taskId} · ${lastResult.creditsCost} credits used · ${lastResult.creditsRemaining} remaining]`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description: "List your most recent tasks and their status.",
      inputSchema: {
        limit: z.number().int().positive().max(50).optional().describe("Max tasks to return (default 20)"),
      },
    },
    async ({ limit }: { limit?: number }) => {
      const tasks = await listTasks(account.licenseKey, limit ?? 20);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              tasks.map((t) => ({
                id: t.id,
                domain: t.domain,
                status: t.status,
                prompt: t.prompt.length > 120 ? `${t.prompt.slice(0, 120)}…` : t.prompt,
                createdAt: new Date(t.createdAt).toISOString(),
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_report",
    {
      title: "Get report",
      description: "Get the full result / deliverable for a specific task by its ID (from list_tasks or assign_task).",
      inputSchema: {
        taskId: z.string().min(1),
      },
    },
    async ({ taskId }: { taskId: string }) => {
      const task = await getTask(taskId, account.licenseKey);
      if (!task) {
        return { isError: true, content: [{ type: "text" as const, text: "Task not found." }] };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: task.status === "completed" ? task.result ?? "" : `Task failed: ${task.error}`,
          },
        ],
      };
    }
  );

  // ── Role registration ───────────────────────────────────────────────────
  // How a connected AI declares what it is. Everything below (token
  // reporting, mission work) is attributed to the role registered here, so
  // the humans in the workspace can see which AI did what.

  server.registerTool(
    "register_role",
    {
      title: "Register my role",
      description:
        "Declare which role you (the connected AI) are filling and which department you serve. Call this first — token reporting and mission updates are attributed to this role. Calling it again with the same name updates the description without losing usage history.",
      inputSchema: {
        name: z.string().min(1).describe('Your role name, e.g. "Newsletter Copywriter"'),
        department: z
          .string()
          .min(1)
          .describe('Department tag you serve, e.g. "marketing" or "coding"'),
        purpose: z.string().min(1).describe("One line on what you do — humans will read this"),
        client: z.string().optional().describe('Which app you are, e.g. "Claude Desktop"'),
        tokenBudget: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Optional cap on your own token spend; 0 or omitted = no cap"),
      },
    },
    async (args: {
      name: string;
      department: string;
      purpose: string;
      client?: string;
      tokenBudget?: number;
    }) => {
      const role = await registerAiRole({ licenseKey: account.licenseKey, ...args });
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Registered as "${role.name}" in ${role.department}.\n` +
              `Tokens used so far: ${role.tokensUsed.toLocaleString()}` +
              (role.tokenBudget > 0 ? ` of ${role.tokenBudget.toLocaleString()}` : " (no cap)"),
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_roles",
    {
      title: "List AI roles",
      description:
        "List every AI role registered on this account, with the department each serves and how many tokens it has used. This is the token report for the whole workspace.",
    },
    async () => {
      const roles = await listAiRoles(account.licenseKey);
      if (roles.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No AI roles registered yet. Use register_role first." },
          ],
        };
      }
      const total = roles.reduce((sum, r) => sum + r.tokensUsed, 0);
      const lines = roles.map(
        (r) =>
          `• ${r.name} — ${r.department} — ${r.tokensUsed.toLocaleString()} tokens` +
          (r.tokenBudget > 0 ? ` / ${r.tokenBudget.toLocaleString()} budget` : "") +
          (r.client ? ` (${r.client})` : "")
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `${roles.length} role(s), ${total.toLocaleString()} tokens total:\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "report_tokens",
    {
      title: "Report token usage",
      description:
        "Report tokens you have just consumed, so the workspace can track spend per AI role. Rejected if it would take the role past its own budget.",
      inputSchema: {
        roleName: z.string().min(1).describe("The role name you registered"),
        tokens: z.number().int().positive().describe("Tokens consumed since your last report"),
      },
    },
    async ({ roleName, tokens }: { roleName: string; tokens: number }) => {
      try {
        const role = await reportTokens(account.licenseKey, roleName, tokens);
        const pct =
          role.tokenBudget > 0 ? ` (${Math.round((role.tokensUsed / role.tokenBudget) * 100)}% of budget)` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `Recorded ${tokens.toLocaleString()} tokens for "${role.name}". Total: ${role.tokensUsed.toLocaleString()}${pct}`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof TokenBudgetExceededError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `⛔ Token budget reached for "${err.roleName}" (${err.used.toLocaleString()}/${err.budget.toLocaleString()}). Ask the department head to raise it in the Lyceum workspace.`,
              },
            ],
          };
        }
        return {
          isError: true,
          content: [{ type: "text" as const, text: err instanceof Error ? err.message : "Failed" }],
        };
      }
    }
  );

  // ── Mission visibility & progress ───────────────────────────────────────
  // The same missions the team sees in the workspace, so a connected AI can
  // read where things stand and move its own step forward.

  server.registerTool(
    "list_missions",
    {
      title: "List missions",
      description:
        "See the missions the team is running, with plain progress percentages. Optionally filter to one department.",
      inputSchema: {
        department: z.string().optional().describe('e.g. "marketing" — omit for all departments'),
      },
    },
    async ({ department }: { department?: string }) => {
      const missions = await listMissions(account.licenseKey, department);
      if (missions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: department
                ? `No missions in ${department} yet.`
                : "No missions yet. Create one with create_mission.",
            },
          ],
        };
      }
      const lines = missions.map((m) => {
        const steps = m.steps
          .map((s) => `    - [${s.status}] ${s.title} — ${s.ownerName} (${s.ownerKind})`)
          .join("\n");
        return `• ${m.title} — ${m.department} — ${progressOf(m)}% — ${m.status}\n  head: ${m.headName}\n  id: ${m.id}\n${steps}`;
      });
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    }
  );

  server.registerTool(
    "create_mission",
    {
      title: "Create a mission",
      description:
        "Create a mission (a piece of work broken into steps) in a department, so the whole team can see it and track progress.",
      inputSchema: {
        department: z.string().min(1).describe('Department tag, e.g. "marketing"'),
        title: z.string().min(1).describe("What needs to happen"),
        goal: z.string().optional().describe("Why it matters"),
        headName: z.string().min(1).describe("The person accountable for the decision"),
        steps: z
          .array(
            z.object({
              title: z.string().min(1),
              ownerKind: z.enum(["human", "ai"]),
              ownerName: z.string().min(1),
            })
          )
          .optional()
          .describe("The steps, each owned by a person or an AI"),
      },
    },
    async (args: {
      department: string;
      title: string;
      goal?: string;
      headName: string;
      steps?: { title: string; ownerKind: "human" | "ai"; ownerName: string }[];
    }) => {
      const mission = await createMission({ licenseKey: account.licenseKey, ...args });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created "${mission.title}" in ${mission.department} with ${mission.steps.length} step(s).\nid: ${mission.id}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "update_mission_step",
    {
      title: "Update a mission step",
      description:
        "Move a step forward, leave a plain-language note on it, and optionally attribute tokens to it. The mission's own status is recalculated from its steps.",
      inputSchema: {
        missionId: z.string().min(1).describe("From list_missions"),
        stepId: z.string().min(1).describe('From list_missions, e.g. "step-1"'),
        status: z.enum(["todo", "doing", "done", "blocked"]).optional(),
        note: z.string().optional().describe("What happened — humans read this"),
        tokens: z.number().int().nonnegative().optional().describe("Tokens spent on this step"),
      },
    },
    async (args: {
      missionId: string;
      stepId: string;
      status?: "todo" | "doing" | "done" | "blocked";
      note?: string;
      tokens?: number;
    }) => {
      const mission = await updateStep({
        licenseKey: account.licenseKey,
        missionId: args.missionId,
        stepId: args.stepId,
        status: args.status,
        note: args.note,
        addTokens: args.tokens,
      });
      if (!mission) {
        return { isError: true, content: [{ type: "text" as const, text: "Mission not found." }] };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated. "${mission.title}" is now ${progressOf(mission)}% (${mission.status}).`,
          },
        ],
      };
    }
  );

  return server;
}

/** Shared error-to-MCP-response mapper used by the assign_task handler. */
function handleTaskError(err: unknown): { isError: true; content: { type: "text"; text: string }[] } {
  if (err instanceof InsufficientCreditsError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Insufficient credits: ${err.remaining} remaining, ${err.requested} needed for this task.`,
        },
      ],
    };
  }
  if (err instanceof NeedsHumanApprovalError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `⚠️ Human approval required\n\n${err.approvalRequest.errorContext}\n\nRequest: ${err.approvalRequest.requestedAction}\nSubmit retry approval via the Lyceum workspace.\n\n[task ${err.taskId}]`,
        },
      ],
    };
  }
  if (err instanceof MaxAttemptsError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `⛔ Max attempts exhausted (${err.maxAttempts}).\n\nLast error: ${err.lastError}\n\n[task ${err.taskId}]`,
        },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : "Task failed" }],
  };
}

export async function handleMcpRequest(req: AuthedRequest, res: express.Response): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed — this is a stateless MCP endpoint (POST only)" });
    return;
  }

  const account = req.lyceumAccount;
  if (!account) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  const server = buildServer(account);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
