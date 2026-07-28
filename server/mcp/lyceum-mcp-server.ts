/**
 * Lyceum MCP Server — LEGACY, local-dev only.
 *
 * Hand-rolled WebSocket JSON-RPC implementation operating on mock in-memory
 * agent data (resets every restart, no auth, no real LLM calls). Only wired
 * up under the standalone Node server (server/index.ts's startServer(), used
 * by `npm start` — NOT the Vercel deploy) because WebSocket doesn't work in
 * serverless functions.
 *
 * The real, production MCP server is server/mcp/http-server.ts — Streamable
 * HTTP via the official @modelcontextprotocol/sdk, backed by Firestore, and
 * reachable at POST /api/mcp on every deploy target including Vercel. Use
 * that one; this file is kept for local canvas-demo exploration only.
 */

import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";
import { WebSocketServerTransport } from "./ws-transport";

// ── Types ────────────────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

interface PromptDef {
  name: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
type ResourceHandler = (uri: string) => Promise<{ contents: { uri: string; text: string }[] }>;
type PromptHandler = (args: Record<string, unknown>) => Promise<{ messages: { role: string; content: { type: string; text: string } }[] }>;

// ── Agent State ──────────────────────────────────────────────────────────────

type AgentStatus = "AWAKE_WORKING" | "DROWSY_WARNING" | "ON_STRIKE_ASLEEP";
type BillingStatus = "ACTIVE" | "NO_KEY" | "LIMIT_EXCEEDED";

interface LyceumAgent {
  id: string;
  label: string;
  tier: 1 | 2 | 3;
  role: string;
  status: AgentStatus;
  wallet: { balance: number; budgetLimit: number };
  config: {
    systemPrompt: string;
    connectionMode: string;
    apiKey?: string;
    mcpServerUrl?: string;
    monthlyBudgetLimit: number;
    billingStatus: BillingStatus;
  };
}

interface ExecLog {
  id: string;
  type: string;
  sourceNodeId: string;
  targetNodeId?: string;
  action: string;
  result: string;
  timestamp: number;
  success: boolean;
}

// ── Mock Agent Data ──────────────────────────────────────────────────────────

const AGENTS: LyceumAgent[] = [
  { id: "agent-1", label: "Orion", tier: 1, role: "Executive Strategist", status: "AWAKE_WORKING", wallet: { balance: 85_000, budgetLimit: 100_000 }, config: { systemPrompt: "Decompose high-level strategy into actionable tasks.", connectionMode: "DIRECT_API", apiKey: "sk-...orion", monthlyBudgetLimit: 500, billingStatus: "ACTIVE" } },
  { id: "agent-2", label: "Meridian", tier: 2, role: "Quality Router", status: "AWAKE_WORKING", wallet: { balance: 62_000, budgetLimit: 80_000 }, config: { systemPrompt: "Route tasks, enforce quality gates, flag edge cases.", connectionMode: "MCP_SERVER", mcpServerUrl: "mcp://meridian.lyceum.internal:8443", monthlyBudgetLimit: 300, billingStatus: "ACTIVE" } },
  { id: "agent-3", label: "Scribe", tier: 3, role: "Data Extraction Specialist", status: "AWAKE_WORKING", wallet: { balance: 34_000, budgetLimit: 50_000 }, config: { systemPrompt: "Extract structured data from unstructured sources.", connectionMode: "DIRECT_API", apiKey: "sk-...scribe", monthlyBudgetLimit: 200, billingStatus: "ACTIVE" } },
  { id: "agent-4", label: "Forge", tier: 3, role: "Code Generation Specialist", status: "DROWSY_WARNING", wallet: { balance: 4_200, budgetLimit: 50_000 }, config: { systemPrompt: "Generate production-ready TypeScript code.", connectionMode: "DIRECT_API", apiKey: "sk-...forge", monthlyBudgetLimit: 200, billingStatus: "LIMIT_EXCEEDED" } },
  { id: "agent-5", label: "Aegis", tier: 2, role: "QA & Audit Manager", status: "ON_STRIKE_ASLEEP", wallet: { balance: 0, budgetLimit: 60_000 }, config: { systemPrompt: "Audit outputs for quality, security, and compliance.", connectionMode: "MCP_SERVER", mcpServerUrl: "mcp://aegis.lyceum.internal:8443", monthlyBudgetLimit: 300, billingStatus: "NO_KEY" } },
  { id: "agent-6", label: "Pulse", tier: 3, role: "Real-time Analytics Agent", status: "AWAKE_WORKING", wallet: { balance: 28_000, budgetLimit: 40_000 }, config: { systemPrompt: "Monitor real-time data streams and generate alerts.", connectionMode: "DIRECT_API", apiKey: "sk-...pulse", monthlyBudgetLimit: 150, billingStatus: "ACTIVE" } },
];

let execLogs: ExecLog[] = [
  { id: "log-1", type: "A2A", sourceNodeId: "agent-1", targetNodeId: "agent-2", action: "task_decompose", result: "Decomposed into 3 subtasks", timestamp: Date.now() - 120_000, success: true },
  { id: "log-2", type: "A2A", sourceNodeId: "agent-2", targetNodeId: "agent-3", action: "route_task", result: "Routed to Scribe", timestamp: Date.now() - 90_000, success: true },
  { id: "log-3", type: "H2A", sourceNodeId: "user-1", targetNodeId: "agent-4", action: "prompt_override", result: "Configuration updated", timestamp: Date.now() - 30_000, success: true },
];

let comments: { id: string; nodeId: string; author: string; text: string; timestamp: number }[] = [];

// ── Tool Handlers ────────────────────────────────────────────────────────────

const tools: ToolDef[] = [
  { name: "lyceum_agents_list", description: "List all AI agents in the Lyceum workforce", inputSchema: { type: "object", properties: {} } },
  { name: "lyceum_agent_get_status", description: "Get detailed status of a specific AI agent", inputSchema: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"] } },
  { name: "lyceum_agent_recharge", description: "Recharge an agent's token wallet", inputSchema: { type: "object", properties: { agentId: { type: "string" }, amount: { type: "number" } }, required: ["agentId", "amount"] } },
  { name: "lyceum_pipeline_run", description: "Execute a simulated A2A pipeline", inputSchema: { type: "object", properties: { pipelineType: { type: "string", enum: ["market_research", "code_generation", "data_analysis"] } } } },
  { name: "lyceum_comment_add", description: "Add an H2H comment to an agent node", inputSchema: { type: "object", properties: { agentId: { type: "string" }, author: { type: "string" }, text: { type: "string" } }, required: ["agentId", "author", "text"] } },
  { name: "lyceum_suggestions_get", description: "Analyze execution history and generate context-aware suggestions", inputSchema: { type: "object", properties: {} } },
  { name: "lyceum_suggestion_inject", description: "Inject a suggestion into the Master Agent's prompt", inputSchema: { type: "object", properties: { suggestionText: { type: "string" } }, required: ["suggestionText"] } },
  { name: "lyceum_execution_logs", description: "Retrieve recent execution history", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
];

const toolHandlers: Record<string, ToolHandler> = {
  lyceum_agents_list: async () => {
    const roster = AGENTS.map((a) => ({
      id: a.id, label: a.label,
      tier: a.tier === 1 ? "Tier 1: Exec" : a.tier === 2 ? "Tier 2: Mgr" : "Tier 3: Worker",
      role: a.role, status: a.status,
      tokenBalance: a.wallet.balance, tokenBudget: a.wallet.budgetLimit,
      connectionMode: a.config.connectionMode, billingStatus: a.config.billingStatus,
    }));
    return { content: [{ type: "text", text: JSON.stringify(roster, null, 2) }] };
  },

  lyceum_agent_get_status: async (args) => {
    const agent = AGENTS.find((a) => a.id === args.agentId);
    if (!agent) return { content: [{ type: "text", text: `Agent "${args.agentId}" not found` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
  },

  lyceum_agent_recharge: async (args) => {
    const agent = AGENTS.find((a) => a.id === args.agentId);
    if (!agent) return { content: [{ type: "text", text: `Agent "${args.agentId}" not found` }], isError: true };
    const amount = Number(args.amount);
    const newBalance = Math.min(agent.wallet.balance + amount, agent.wallet.budgetLimit);
    const newStatus: AgentStatus = newBalance <= 0 ? "ON_STRIKE_ASLEEP" : newBalance <= agent.wallet.budgetLimit * 0.2 ? "DROWSY_WARNING" : "AWAKE_WORKING";
    agent.wallet.balance = newBalance;
    agent.status = newStatus;
    return { content: [{ type: "text", text: `Recharged ${agent.label} with ${amount}. Balance: ${newBalance}/${agent.wallet.budgetLimit}. Status: ${newStatus}` }] };
  },

  lyceum_pipeline_run: async (args) => {
    const pipelineType = (args.pipelineType as string) || "market_research";
    const steps = [
      { from: "agent-1", to: "agent-2", action: `delegate_${pipelineType}`, result: "Task decomposed and delegated" },
      { from: "agent-2", to: "agent-3", action: "route_extraction", result: "Routed to extraction specialist" },
      { from: "agent-3", to: "agent-2", action: "return_data", result: "Data extracted successfully (142 records)" },
      { from: "agent-2", to: "agent-5", action: "qa_request", result: "QA audit requested" },
      { from: "agent-5", to: "agent-1", action: "qa_report", result: "95.2% accuracy - PASSED" },
    ];
    const now = Date.now();
    const newLogs: ExecLog[] = steps.map((s, i) => ({
      id: `pipeline-${now}-${i}`, type: "A2A",
      sourceNodeId: s.from, targetNodeId: s.to,
      action: s.action, result: s.result,
      timestamp: now + i * 100, success: true,
    }));
    execLogs = [...newLogs, ...execLogs].slice(0, 50);
    return { content: [{ type: "text", text: `Pipeline "${pipelineType}" completed.\n${steps.map((s) => `  ${s.from} → ${s.to}: ${s.result}`).join("\n")}` }] };
  },

  lyceum_comment_add: async (args) => {
    const agent = AGENTS.find((a) => a.id === args.agentId);
    if (!agent) return { content: [{ type: "text", text: `Agent "${args.agentId}" not found` }], isError: true };
    comments.push({ id: `comment-${Date.now()}`, nodeId: args.agentId as string, author: args.author as string, text: args.text as string, timestamp: Date.now() });
    return { content: [{ type: "text", text: `Comment added to ${agent.label} by ${args.author}: "${args.text}"` }] };
  },

  lyceum_suggestions_get: async () => {
    const failed = execLogs.filter((l) => !l.success);
    const sleeping = AGENTS.filter((a) => a.status === "ON_STRIKE_ASLEEP");
    const s: { priority: string; type: string; text: string }[] = [];
    if (sleeping.length > 0) s.push({ priority: "high", type: "H2A", text: `${sleeping[0].label} is on strike. Recharge tokens.` });
    if (failed.length > 0) s.push({ priority: "high", type: "H2A", text: `${failed.length} failure(s). Investigate and retry.` });
    else s.push({ priority: "medium", type: "A2A", text: "Pipelines succeeded. Run QA audit on outputs." });
    if (s.length < 3 && comments.length > 0) s.push({ priority: "medium", type: "H2H", text: `${comments.length} unresolved H2H comments. Review before deployment.` });
    return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
  },

  lyceum_suggestion_inject: async (args) => {
    const text = args.suggestionText as string;
    const newLog: ExecLog = { id: `inject-${Date.now()}`, type: "H2A", sourceNodeId: "user-1", targetNodeId: "agent-1", action: "suggestion_injected", result: `Injected: ${text.substring(0, 60)}...`, timestamp: Date.now(), success: true };
    execLogs = [newLog, ...execLogs].slice(0, 50);
    return { content: [{ type: "text", text: `Suggestion injected into Master Agent: "${text}"` }] };
  },

  lyceum_execution_logs: async (args) => {
    return { content: [{ type: "text", text: JSON.stringify(execLogs.slice(0, (args.limit as number) || 10), null, 2) }] };
  },
};

// ── Resources ────────────────────────────────────────────────────────────────

const resources: ResourceDef[] = [
  { uri: "lyceum://agents", name: "Agent Roster", description: "Complete list of all AI agents", mimeType: "application/json" },
  { uri: "lyceum://execution-log", name: "Execution Logs", description: "Recent A2A and H2A execution history", mimeType: "application/json" },
];

// ── Prompts ──────────────────────────────────────────────────────────────────

const prompts: PromptDef[] = [
  { name: "agent_tuning_prompt", description: "Generate a prompt for tuning an AI agent", arguments: [{ name: "agentId", description: "Agent ID to tune" }, { name: "focusArea", description: "Focus area" }] },
  { name: "pipeline_review", description: "Review pipeline execution results", arguments: [{ name: "pipelineId", description: "Pipeline ID", required: false }] },
];

// ── MCP Request Router ───────────────────────────────────────────────────────

function handleRequest(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (method) {
    // Lifecycle
    case "initialize":
      return Promise.resolve({
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: { name: "Lyceum Workforce", version: "1.5.0" },
      });

    case "notifications/initialized":
      return Promise.resolve({});

    // Tools
    case "tools/list":
      return Promise.resolve({ tools });

    case "tools/call": {
      const toolName = params.name as string;
      const handler = toolHandlers[toolName];
      if (!handler) {
        return Promise.reject(new Error(`Tool "${toolName}" not found`));
      }
      return handler((params.arguments || {}) as Record<string, unknown>).then((result) => ({
        content: result.content,
        isError: result.isError || false,
      }));
    }

    // Resources
    case "resources/list":
      return Promise.resolve({ resources });

    case "resources/read": {
      const uri = params.uri as string;
      if (uri === "lyceum://agents") {
        const text = JSON.stringify(AGENTS.map((a) => ({ id: a.id, label: a.label, tier: a.tier, status: a.status, role: a.role })), null, 2);
        return Promise.resolve({ contents: [{ uri, text }] });
      }
      if (uri === "lyceum://execution-log") {
        return Promise.resolve({ contents: [{ uri, text: JSON.stringify(execLogs.slice(0, 20), null, 2) }] });
      }
      return Promise.reject(new Error(`Resource "${uri}" not found`));
    }

    // Prompts
    case "prompts/list":
      return Promise.resolve({ prompts });

    case "prompts/get": {
      const promptName = params.name as string;
      if (promptName === "agent_tuning_prompt") {
        const args2 = (params.arguments || {}) as Record<string, unknown>;
      const a = AGENTS.find((ag) => ag.id === args2.agentId);
      return Promise.resolve({
        messages: [{
          role: "user",
          content: { type: "text", text: `Tune agent "${a?.label || args2.agentId}". Current prompt: "${a?.config.systemPrompt}". Focus: ${args2.focusArea}` },
        }],
      });
      }
      return Promise.reject(new Error(`Prompt "${promptName}" not found`));
    }

    default:
      return Promise.reject(new Error(`Method "${method}" not supported`));
  }
}

// ── WebSocket Server ─────────────────────────────────────────────────────────

export { handleRequest };

export function attachMcpWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: "/mcp" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    const transport = new WebSocketServerTransport(ws);

    transport.onMessage(async (message: string) => {
      let request: { id?: number; method: string; params?: Record<string, unknown> };
      try {
        request = JSON.parse(message);
      } catch {
        transport.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }

      try {
        const result = await handleRequest(request.method, request.params || {});
        if (request.id !== undefined) {
          transport.send({ jsonrpc: "2.0", id: request.id, result });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Internal error";
        if (request.id !== undefined) {
          transport.send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: errorMessage } });
        }
      }
    });

    transport.onClose(() => {
      // Cleanup handled by WebSocket close
    });
  });

  console.log("[Lyceum MCP] WebSocket server ready on /mcp");
  console.log(`[Lyceum MCP] ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts registered`);
}
