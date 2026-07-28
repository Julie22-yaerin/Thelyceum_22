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
import { InsufficientCreditsError, runTask, TASK_COST } from "../lib/runTask.js";
import type { AuthedRequest } from "../lib/auth.js";

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
      try {
        const result = await runTask({
          licenseKey: account.licenseKey,
          domain: domain as Domain,
          prompt,
          source: "mcp",
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `${result.result}\n\n[task ${result.taskId} · ${result.creditsCost} credits used · ${result.creditsRemaining} remaining]`,
            },
          ],
        };
      } catch (err) {
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
        return {
          isError: true,
          content: [{ type: "text" as const, text: err instanceof Error ? err.message : "Task failed" }],
        };
      }
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

  return server;
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
