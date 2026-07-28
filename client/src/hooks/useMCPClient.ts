import { useCallback, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MCPToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface MCPAgent {
  id: string;
  label: string;
  tier: string;
  role: string;
  status: string;
  tokenBalance: number;
  tokenBudget: number;
  connectionMode: string;
  billingStatus: string;
}

export interface MCPAgentDetail {
  id: string;
  label: string;
  tier: number;
  role: string;
  status: string;
  wallet: { balance: number; budgetLimit: number };
  config: {
    systemPrompt: string;
    connectionMode: string;
    apiKey?: string;
    mcpServerUrl?: string;
    monthlyBudgetLimit: number;
    billingStatus: string;
  };
}

export interface MCPExecutionLog {
  id: string;
  type: string;
  sourceNodeId: string;
  targetNodeId?: string;
  action: string;
  result: string;
  timestamp: number;
  success: boolean;
}

export interface MCPSuggestion {
  priority: string;
  type: string;
  text: string;
}

export type MCPConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// ── JSON-RPC Helpers ─────────────────────────────────────────────────────────

let requestId = 1;

function createJsonRpcRequest(method: string, params?: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id: requestId++,
    method,
    params: params || {},
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useMCPClient() {
  const [status, setStatus] = useState<MCPConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>>(new Map());

  const connect = useCallback((url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      setStatus("connecting");
      setError(null);

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setStatus("connected");
          resolve();
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.id && pendingRef.current.has(msg.id)) {
              const { resolve: res, reject: rej } = pendingRef.current.get(msg.id)!;
              pendingRef.current.delete(msg.id);
              if (msg.error) {
                rej(new Error(msg.error.message || "MCP error"));
              } else {
                res(msg.result);
              }
            }
          } catch {
            // ignore parse errors
          }
        };

        ws.onclose = () => {
          setStatus("disconnected");
          wsRef.current = null;
        };

        ws.onerror = () => {
          setStatus("error");
          setError("WebSocket connection failed");
          reject(new Error("WebSocket connection failed"));
        };
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Unknown error");
        reject(err);
      }
    });
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
  }, []);

  const sendRequest = useCallback(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected to MCP server"));
        return;
      }

      const request = createJsonRpcRequest(method, params);
      pendingRef.current.set(request.id, { resolve, reject });
      ws.send(JSON.stringify(request));
    });
  }, []);

  // ── High-level Tool Methods ─────────────────────────────────────────────

  const safeParseJson = useCallback(<T>(text: string | undefined, fallback: T): T => {
    if (!text) return fallback;
    try { return JSON.parse(text); } catch { return fallback; }
  }, []);

  const listAgents = useCallback(async (): Promise<MCPAgent[]> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_agents_list",
      arguments: {},
    })) as MCPToolResult;
    return safeParseJson(result.content?.[0]?.text, []);
  }, [sendRequest, safeParseJson]);

  const getAgentStatus = useCallback(async (agentId: string): Promise<MCPAgentDetail | null> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_agent_get_status",
      arguments: { agentId },
    })) as MCPToolResult;
    if (result.isError) return null;
    return safeParseJson(result.content?.[0]?.text, null);
  }, [sendRequest, safeParseJson]);

  const rechargeAgent = useCallback(async (agentId: string, amount: number): Promise<string> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_agent_recharge",
      arguments: { agentId, amount },
    })) as MCPToolResult;
    return result.content?.[0]?.text || "Recharge failed";
  }, [sendRequest]);

  const runPipeline = useCallback(async (pipelineType?: string): Promise<string> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_pipeline_run",
      arguments: { pipelineType: pipelineType || "market_research" },
    })) as MCPToolResult;
    return result.content?.[0]?.text || "Pipeline execution failed";
  }, [sendRequest]);

  const getSuggestions = useCallback(async (): Promise<MCPSuggestion[]> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_suggestions_get",
      arguments: {},
    })) as MCPToolResult;
    return safeParseJson(result.content?.[0]?.text, []);
  }, [sendRequest, safeParseJson]);

  const injectSuggestion = useCallback(async (suggestionText: string): Promise<string> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_suggestion_inject",
      arguments: { suggestionText },
    })) as MCPToolResult;
    return result.content?.[0]?.text || "Injection failed";
  }, [sendRequest]);

  const getExecutionLogs = useCallback(async (limit = 10): Promise<MCPExecutionLog[]> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_execution_logs",
      arguments: { limit },
    })) as MCPToolResult;
    return safeParseJson(result.content?.[0]?.text, []);
  }, [sendRequest, safeParseJson]);

  const addComment = useCallback(async (agentId: string, author: string, text: string): Promise<string> => {
    const result = (await sendRequest("tools/call", {
      name: "lyceum_comment_add",
      arguments: { agentId, author, text },
    })) as MCPToolResult;
    return result.content?.[0]?.text || "Failed to add comment";
  }, [sendRequest]);

  return {
    status,
    error,
    connect,
    disconnect,
    sendRequest,
    listAgents,
    getAgentStatus,
    rechargeAgent,
    runPipeline,
    getSuggestions,
    injectSuggestion,
    getExecutionLogs,
    addComment,
  };
}
