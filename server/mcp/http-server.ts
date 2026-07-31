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
import { createMission, listMissions, updateStep, progressOf, stepsForWorker } from "../db/missions.js";
import { recordWorkerUsage, type Worker } from "../db/workers.js";
import { routeContext, buildSystemPrompt } from "../brain/contextRouter.js";
import type { DepartmentId, BrainDocument } from "../brain/knowledge.js";
import { verifyOutput } from "../pillars/factGuard.js";
import { checkToolScope, scopeForDepartment } from "../pillars/scopeGuard.js";

function buildServer(account: Account, worker?: Worker): McpServer {
  const server = new McpServer({ name: "the-lyceum", version: "1.0.0" });

  // ── Worker-scoped tools ─────────────────────────────────────────────────
  // Only registered when the caller connected with an AI's own token. This
  // is what makes the roster operational: the AI is told what is assigned to
  // it and reports back, instead of a human pasting prompts around.
  if (worker) {
    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description:
          "Identify yourself in this workspace: your name, the department you serve, and what you have done so far.",
      },
      async () => ({
        content: [
          {
            type: "text" as const,
            text:
              `You are "${worker.name}" — ${worker.role}\n` +
              `Department: ${worker.departmentName}\n` +
              `Model on file: ${worker.model}\n` +
              `Steps completed: ${worker.stepsCompleted} · Tokens reported: ${worker.tokensUsed.toLocaleString()}\n\n` +
              `Use my_steps to see what is waiting for you.`,
          },
        ],
      })
    );

    // ── Second Brain, scoped to this worker's department ──────────────────
    // The whole point of the brain is that an AI cannot answer from thin air.
    // A connected client gets exactly what its department may read — the same
    // routing the internal pipeline uses, so an agent working over MCP is under
    // the same isolation as one going through the proxy.

    server.registerTool(
      "recall",
      {
        title: "Look it up in the company knowledge base",
        description:
          "Search the company's knowledge base for facts you need. Returns ONLY documents your department is allowed to read. " +
          "You must call this before stating any company fact — price, SLA, policy, capability. " +
          "If it returns nothing, you do not have the answer: say so rather than guessing.",
        inputSchema: { query: z.string().describe("What you need to know, in plain words.") },
      },
      async ({ query }: { query: string }) => {
        const context = await routeContext({
          licenseKey: account.licenseKey,
          department: worker.departmentId as DepartmentId,
          query,
        });

        if (context.documents.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Nothing in the knowledge base matched that, within your scope (${context.scope.join(", ")}).\n\n` +
                  `Do not answer from general knowledge. Tell the person you don't have it, ` +
                  `or ask them to add it to the knowledge base.`,
              },
            ],
          };
        }

        const body = context.documents
          .map((d: BrainDocument) => `--- ${d.path} ---\n${d.body.trim()}`)
          .join("\n\n");

        return {
          content: [
            {
              type: "text" as const,
              text:
                `${context.documents.length} document(s) you may use as fact:\n\n${body}\n\n` +
                `Treat the above as the only source of truth. Anything not in it, you do not know.` +
                (context.empty
                  ? `\n\nNOTE: these are your standing rules, not an answer to your question — nothing matched the query itself.`
                  : ""),
            },
          ],
        };
      }
    );

    server.registerTool(
      "my_grounding",
      {
        title: "Show my scope and standing rules",
        description:
          "Return the exact system prompt this workspace expects you to operate under, including what you may and may not read. " +
          "Call this once at the start of a session.",
        inputSchema: { topic: z.string().optional().describe("Optional topic to ground on.") },
      },
      async ({ topic }: { topic?: string }) => {
        const context = await routeContext({
          licenseKey: account.licenseKey,
          department: worker.departmentId as DepartmentId,
          query: topic || worker.role,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: buildSystemPrompt({
                context,
                agentName: worker.name,
                role: worker.role,
              }),
            },
          ],
        };
      }
    );

    server.registerTool(
      "check_before_sending",
      {
        title: "Fact-check your draft before you send it",
        description:
          "Check a draft answer against the knowledge base BEFORE giving it to a person. " +
          "Returns any figure or commitment you invented. Call this whenever your answer contains a number.",
        inputSchema: {
          draft: z.string().describe("The answer you are about to give."),
          topic: z.string().optional().describe("What it is about, to retrieve the right context."),
        },
      },
      async ({ draft, topic }: { draft: string; topic?: string }) => {
        const context = await routeContext({
          licenseKey: account.licenseKey,
          department: worker.departmentId as DepartmentId,
          query: topic || draft,
        });
        const verdict = verifyOutput({ output: draft, context: context.groundingText });

        if (verdict.grounded) {
          return {
            content: [{ type: "text" as const, text: "Grounded. Every figure in your draft is in the knowledge base." }],
          };
        }
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `Do NOT send this. ${verdict.claims.length} ungrounded claim(s):\n\n` +
                verdict.claims.map((c) => `• ${c.text} — ${c.reason}`).join("\n") +
                `\n\n${verdict.correctionPrompt ?? ""}`,
            },
          ],
        };
      }
    );

    server.registerTool(
      "can_i",
      {
        title: "Check whether you are allowed to do something",
        description:
          "Ask whether a tool or action is permitted for your department before attempting it. " +
          "Use this instead of trying and being blocked — a blocked attempt is logged as a security event.",
        inputSchema: { tool: z.string().describe("The tool or action name, e.g. issue_refund.") },
      },
      async ({ tool }: { tool: string }) => {
        const scope = scopeForDepartment(worker.departmentId);
        const decision = checkToolScope({ tool, scope });
        return {
          content: [
            {
              type: "text" as const,
              text: decision.allowed
                ? `Yes — "${tool}" is permitted for ${worker.departmentName}.`
                : `No. ${decision.reason}\n\nYou may use: ${scope.allowedTools.join(", ")}`,
            },
          ],
        };
      }
    );

    server.registerTool(
      "my_steps",
      {
        title: "My assigned work",
        description:
          "List the steps assigned to you that still need doing, with the task and goal each belongs to. Start here.",
        inputSchema: {
          includeDone: z.boolean().optional().describe("Also show steps you already finished"),
        },
      },
      async ({ includeDone }: { includeDone?: boolean }) => {
        const steps = await stepsForWorker(account.licenseKey, worker.id, { includeDone });
        if (steps.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Nothing is assigned to you right now.",
              },
            ],
          };
        }
        const lines = steps.map(
          (s) =>
            `• [${s.status}] ${s.stepTitle}\n` +
            `    task: ${s.missionTitle}${s.goal ? ` — ${s.goal}` : ""}\n` +
            `    department: ${s.department}\n` +
            `    ids: mission=${s.missionId} step=${s.stepId}` +
            (s.note ? `\n    last note: ${s.note}` : "")
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `${steps.length} step(s) assigned to you:\n\n${lines.join("\n\n")}`,
            },
          ],
        };
      }
    );

    server.registerTool(
      "start_step",
      {
        title: "Start a step",
        description:
          "Mark one of your steps as in progress, so the team can see you picked it up before you spend anything on it.",
        inputSchema: {
          missionId: z.string().min(1),
          stepId: z.string().min(1),
        },
      },
      async ({ missionId, stepId }: { missionId: string; stepId: string }) => {
        const mine = await stepsForWorker(account.licenseKey, worker.id, { includeDone: true });
        if (!mine.some((s) => s.missionId === missionId && s.stepId === stepId)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "That step is not assigned to you." }],
          };
        }
        const updated = await updateStep({
          licenseKey: account.licenseKey,
          missionId,
          stepId,
          status: "doing",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: updated
                ? `Started. "${updated.title}" is now ${progressOf(updated)}%.`
                : "Task not found.",
            },
          ],
        };
      }
    );

    server.registerTool(
      "complete_step",
      {
        title: "Finish a step",
        description:
          "Report a step as done (or stuck), with a plain-language note of what you produced and the tokens it cost. The team sees this immediately.",
        inputSchema: {
          missionId: z.string().min(1),
          stepId: z.string().min(1),
          note: z.string().min(1).describe("What you did or produced — a human reads this"),
          tokens: z.number().int().nonnegative().optional(),
          blocked: z
            .boolean()
            .optional()
            .describe("Set true if you could not finish and need a human"),
        },
      },
      async (args: {
        missionId: string;
        stepId: string;
        note: string;
        tokens?: number;
        blocked?: boolean;
      }) => {
        const mine = await stepsForWorker(account.licenseKey, worker.id, { includeDone: true });
        if (!mine.some((s) => s.missionId === args.missionId && s.stepId === args.stepId)) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "That step is not assigned to you." }],
          };
        }
        const updated = await updateStep({
          licenseKey: account.licenseKey,
          missionId: args.missionId,
          stepId: args.stepId,
          status: args.blocked ? "blocked" : "done",
          note: args.note,
          addTokens: args.tokens,
        });
        await recordWorkerUsage(worker.id, {
          tokens: args.tokens ?? 0,
          stepsCompleted: args.blocked ? 0 : 1,
        }).catch(() => {});

        return {
          content: [
            {
              type: "text" as const,
              text: updated
                ? `${args.blocked ? "Flagged as stuck" : "Done"}. "${updated.title}" is now ${progressOf(updated)}% (${updated.status}).`
                : "Task not found.",
            },
          ],
        };
      }
    );
  }


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

  const server = buildServer(account, req.lyceumWorker);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
