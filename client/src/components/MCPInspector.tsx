import {
  Beaker,
  ChevronDown,
  ChevronRight,
  Copy,
  Play,
  RefreshCw,
  Search,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useMCPClient, type MCPConnectionStatus } from "@/hooks/useMCPClient";

// ── Types ────────────────────────────────────────────────────────────────────

interface MCPToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPCallResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
}

interface CallHistoryEntry {
  id: number;
  tool: string;
  args: string;
  response: string;
  timestamp: number;
  success: boolean;
}

// ── Connection Badge ─────────────────────────────────────────────────────────

function MCPStatusBadge({ status }: { status: MCPConnectionStatus }) {
  const dotMap: Record<MCPConnectionStatus, string> = {
    connected: "bg-green-400",
    connecting: "bg-yellow-400 animate-pulse",
    disconnected: "bg-gray-500",
    error: "bg-red-400",
  };
  const labelMap: Record<MCPConnectionStatus, string> = {
    connected: "Connected",
    connecting: "Connecting...",
    disconnected: "Disconnected",
    error: "Error",
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px]">
      <span className={cn("w-1.5 h-1.5 rounded-full", dotMap[status])} />
      <span className="text-muted-foreground">{labelMap[status]}</span>
    </span>
  );
}

// ── JSON Formatter ───────────────────────────────────────────────────────────

function formatJson(input: string, fallback: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return fallback;
  }
}

// ── Default Arguments Templates ──────────────────────────────────────────────

const DEFAULT_ARGS: Record<string, string> = {
  lyceum_agents_list: "{}",
  lyceum_agent_get_status: JSON.stringify({ agentId: "agent-1" }, null, 2),
  lyceum_agent_recharge: JSON.stringify({ agentId: "agent-4", amount: 50000 }, null, 2),
  lyceum_pipeline_run: JSON.stringify({ pipelineType: "market_research" }, null, 2),
  lyceum_comment_add: JSON.stringify({ agentId: "agent-1", author: "Inspector", text: "Reviewed via MCP Inspector" }, null, 2),
  lyceum_suggestions_get: "{}",
  lyceum_suggestion_inject: JSON.stringify({ suggestionText: "Run a full QA audit on all recent outputs." }, null, 2),
  lyceum_execution_logs: JSON.stringify({ limit: 5 }, null, 2),
};

// ── Main Component ───────────────────────────────────────────────────────────

export default function MCPInspector() {
  const mcp = useMCPClient();
  const [mcpStatus, setMcpStatus] = useState<MCPConnectionStatus>("disconnected");
  const [tools, setTools] = useState<MCPToolDef[]>([]);
  const [selectedTool, setSelectedTool] = useState<MCPToolDef | null>(null);
  const [argsText, setArgsText] = useState("{}");
  const [responseText, setResponseText] = useState<string | null>(null);
  const [responseError, setResponseError] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [callHistory, setCallHistory] = useState<CallHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const statusRef = useRef<MCPConnectionStatus>("disconnected");

  // Connect to MCP server on mount
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    mcp.connect(`${protocol}//${host}/mcp`).catch(() => {});
    return () => { mcp.disconnect(); };
  }, []);

  // Poll MCP connection status
  useEffect(() => {
    const interval = setInterval(() => {
      if (mcp.status !== statusRef.current) {
        statusRef.current = mcp.status;
        setMcpStatus(mcp.status);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [mcp.status]);

  // Fetch tools list when connected
  useEffect(() => {
    if (mcpStatus === "connected" && tools.length === 0) {
      fetchTools();
    }
  }, [mcpStatus]);

  const fetchTools = useCallback(async () => {
    try {
      const result = await mcp.sendRequest("tools/list", {}) as { tools?: MCPToolDef[] };
      if (result?.tools) {
        setTools(result.tools);
        const toolList = result.tools;
        if (toolList.length > 0 && !selectedTool) {
          const first = toolList[0];
          setSelectedTool(first);
          setArgsText(DEFAULT_ARGS[first.name] || "{}");
        }
      }
    } catch {
      // Silently fail
    }
  }, [mcpStatus]);

  const handleToolSelect = useCallback((tool: MCPToolDef) => {
    setSelectedTool(tool);
    setArgsText(DEFAULT_ARGS[tool.name] || "{}");
    setResponseText(null);
    setResponseError(false);
  }, []);

  const handleCallTool = useCallback(async () => {
    if (!selectedTool || isCalling) return;

    setIsCalling(true);
    setResponseText(null);
    setResponseError(false);

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(argsText);
    } catch {
      setResponseText("Invalid JSON in arguments. Please fix the syntax.");
      setResponseError(true);
      setIsCalling(false);
      return;
    }

    try {
      const result = await mcp.sendRequest("tools/call", {
        name: selectedTool.name,
        arguments: parsedArgs,
      }) as MCPCallResult;

      const responseStr = result?.content?.[0]?.text || JSON.stringify(result, null, 2);
      const isErr = result?.isError === true;
      setResponseText(responseStr);
      setResponseError(isErr);

      setCallHistory((prev) => [{
        id: Date.now(),
        tool: selectedTool.name,
        args: argsText,
        response: responseStr,
        timestamp: Date.now(),
        success: !isErr,
      }, ...prev].slice(0, 20));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setResponseText(`Error: ${errMsg}`);
      setResponseError(true);
      setCallHistory((prev) => [{
        id: Date.now(),
        tool: selectedTool.name,
        args: argsText,
        response: `Error: ${errMsg}`,
        timestamp: Date.now(),
        success: false,
      }, ...prev].slice(0, 20));
    } finally {
      setIsCalling(false);
    }
  }, [selectedTool, argsText, isCalling, mcp]);

  const handleCopyResponse = useCallback(() => {
    if (responseText) {
      navigator.clipboard.writeText(responseText);
    }
  }, [responseText]);

  const filteredTools = tools.filter(
    (t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const argsHasError = (() => {
    try { JSON.parse(argsText); return false; } catch { return argsText.trim().length > 0; }
  })();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ws-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center">
            <Terminal className="w-3.5 h-3.5 text-indigo-700" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-ws-text">MCP Inspector</h3>
            <p className="text-[9px] text-muted-foreground">Tool Explorer & Debugger</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <MCPStatusBadge status={mcpStatus} />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Tool List */}
        <div className="w-[140px] border-r border-ws-border flex flex-col">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools..."
                className="h-7 pl-6 text-[10px] bg-ws-subtle border-ws-border text-ws-text placeholder:text-muted-foreground/40"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-1.5 pb-2 space-y-0.5">
              {filteredTools.map((tool) => (
                <button
                  key={tool.name}
                  onClick={() => handleToolSelect(tool)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-md text-[10px] transition-colors",
                    selectedTool?.name === tool.name
                      ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                      : "text-muted-foreground hover:text-ws-text hover:bg-ws-hover"
                  )}
                >
                  <div className="font-medium truncate">{tool.name.replace("lyceum_", "")}</div>
                  <div className="text-[8px] text-muted-foreground/60 truncate mt-0.5">{tool.description.substring(0, 40)}</div>
                </button>
              ))}
              {filteredTools.length === 0 && (
                <div className="text-[10px] text-muted-foreground text-center py-4">
                  {mcpStatus !== "connected" ? "Connect to see tools" : "No tools found"}
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="p-2 border-t border-ws-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-6 text-[9px] text-muted-foreground hover:text-ws-text"
              onClick={fetchTools}
            >
              <RefreshCw className="w-2.5 h-2.5 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Right: Tool Detail */}
        <div className="flex-1 flex flex-col">
          {selectedTool ? (
            <>
              {/* Tool Info */}
              <div className="px-3 py-2 border-b border-ws-border">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-semibold text-ws-text">{selectedTool.name}</span>
                  <Badge variant="outline" className="text-[8px] px-1 py-0 text-muted-foreground border-ws-border">
                    tool
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">{selectedTool.description}</p>
              </div>

              {/* Arguments */}
              <div className="px-3 py-2 border-b border-ws-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-muted-foreground font-medium">Arguments (JSON)</span>
                  {argsHasError && (
                    <span className="text-[8px] text-red-700">Invalid JSON</span>
                  )}
                </div>
                <textarea
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  className={cn(
                    "w-full h-20 bg-ws-subtle border rounded-md px-2.5 py-1.5 text-[10px] font-mono text-ws-text-muted resize-none outline-none transition-colors",
                    argsHasError ? "border-red-200" : "border-ws-border focus:border-indigo-200"
                  )}
                  spellCheck={false}
                />
              </div>

              {/* Call Button */}
              <div className="px-3 py-2 border-b border-ws-border">
                <Button
                  size="sm"
                  className={cn(
                    "w-full h-7 text-[10px] gap-1.5",
                    isCalling
                      ? "bg-amber-100 text-amber-700 border border-amber-200"
                      : "bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                  )}
                  onClick={handleCallTool}
                  disabled={isCalling || mcpStatus !== "connected"}
                >
                  <Play className={cn("w-3 h-3", isCalling && "animate-pulse")} />
                  {isCalling ? "Calling..." : "Call Tool"}
                </Button>
              </div>

              {/* Response */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-ws-border">
                  <span className="text-[9px] text-muted-foreground font-medium">Response</span>
                  {responseText && (
                    <button onClick={handleCopyResponse} className="text-muted-foreground hover:text-ws-text transition-colors">
                      <Copy className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-3">
                    {responseText ? (
                      <pre
                        className={cn(
                          "text-[10px] font-mono leading-relaxed whitespace-pre-wrap",
                          responseError ? "text-red-700" : "text-green-700"
                        )}
                      >
                        {formatJson(responseText, responseText)}
                      </pre>
                    ) : (
                      <div className="text-center py-8">
                        <Terminal className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-[10px] text-muted-foreground">
                          Select a tool and click "Call Tool"
                        </p>
                        <p className="text-[8px] text-muted-foreground/50 mt-1">Response will appear here</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Beaker className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">Select a tool from the left panel</p>
                <p className="text-[10px] text-muted-foreground/50 mt-1">
                  {tools.length > 0 ? `${tools.length} tools available` : "Connect to MCP server to browse tools"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Call History Bar */}
      {callHistory.length > 0 && (
        <div className="border-t border-ws-border">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-4 py-1.5 text-[9px] text-muted-foreground hover:text-ws-text transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <RefreshCw className="w-2.5 h-2.5" />
              Call History ({callHistory.length})
            </span>
            {showHistory ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
          </button>
          {showHistory && (
            <div className="max-h-[120px] overflow-y-auto px-4 pb-2 space-y-1">
              {callHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 text-[9px]"
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", entry.success ? "bg-green-400" : "bg-red-400")} />
                  <span className="text-muted-foreground font-mono truncate">{entry.tool}</span>
                  <span className="text-muted-foreground/50 truncate flex-1">{entry.response.substring(0, 40)}</span>
                  <button
                    onClick={() => {
                      setResponseText(entry.response);
                      setResponseError(!entry.success);
                    }}
                    className="text-indigo-700 hover:text-indigo-800 shrink-0"
                  >
                    <Terminal className="w-2 h-2" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
