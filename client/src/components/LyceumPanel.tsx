import {
  AlertCircle,
  Bell,
  Brain,
  ChevronDown,
  ChevronUp,
  Clock,
  FlaskConical,
  Lightbulb,
  MessageCircle,
  RefreshCw,
  Terminal,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import MCPInspector from "@/components/MCPInspector";
import AlertDashboard from "@/components/AlertDashboard";

// ── Suggestion Card ──────────────────────────────────────────────────────────

function SuggestionCard({
  suggestion,
  onInject,
}: {
  suggestion: { id: string; text: string; type: string; priority: string };
  onInject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const iconMap = {
    H2A: Zap,
    A2A: RefreshCw,
    H2H: MessageCircle,
  };
  const colorMap = {
    H2A: "text-teal-400 bg-teal-500/10 border-teal-500/20",
    A2A: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    H2H: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  };
  const priorityColor = {
    high: "text-red-400 border-red-500/30 bg-red-500/10",
    medium: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    low: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  };

  const Icon = iconMap[suggestion.type as keyof typeof iconMap] || Lightbulb;

  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg overflow-hidden hover:border-white/10 transition-colors">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2.5 p-3 text-left"
      >
        <div className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5", colorMap[suggestion.type as keyof typeof colorMap])}>
          <Icon className="w-3 h-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", priorityColor[suggestion.priority as keyof typeof priorityColor])}>
              {suggestion.priority}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{suggestion.type}</span>
          </div>
          <p className={cn("text-xs leading-relaxed text-gray-300", !expanded && "line-clamp-2")}>
            {suggestion.text}
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
        )}
      </button>

      {/* Expanded actions */}
      {expanded && (
        <div className="px-3 pb-3 flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-[10px] px-3 bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
            onClick={() => onInject(suggestion.id)}
          >
            <Zap className="w-3 h-3 mr-1" />
            Inject to Master
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[10px] px-2 text-muted-foreground hover:text-white"
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Execution Log Entry ──────────────────────────────────────────────────────

function LogEntry({
  log,
}: {
  log: {
    id: string;
    type: string;
    sourceNodeId: string;
    targetNodeId?: string;
    action: string;
    payload: string;
    result: string;
    timestamp: number;
    success: boolean;
  };
}) {
  const { nodes } = useWorkforceStore();
  const sourceNode = nodes.find((n) => n.id === log.sourceNodeId);
  const targetNode = nodes.find((n) => n.id === log.targetNodeId);

  const timeStr = new Date(log.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex items-start gap-2.5 py-2 px-3 hover:bg-white/[0.02] rounded-lg transition-colors">
      <div
        className={cn(
          "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
          log.success ? "bg-green-400" : "bg-red-400"
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Badge
            variant="outline"
            className={cn(
              "text-[8px] px-1 py-0",
              log.type === "A2A"
                ? "text-blue-400 border-blue-500/20"
                : "text-teal-400 border-teal-500/20"
            )}
          >
            {log.type}
          </Badge>
          <span className="text-[9px] text-muted-foreground font-mono">{timeStr}</span>
        </div>
        <p className="text-[10px] text-gray-400 leading-relaxed">
          <span className="text-white/70">{sourceNode?.data.label || log.sourceNodeId}</span>
          {log.targetNodeId && (
            <>
              <span className="text-muted-foreground"> → </span>
              <span className="text-white/70">{targetNode?.data.label || log.targetNodeId}</span>
            </>
          )}
        </p>
        <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">{log.result}</p>
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export default function LyceumPanel() {
  const {
    executionLogs,
    lyceumSuggestions,
    getLyceumSuggestions,
    injectSuggestion,
    setLyceumPanelOpen,
  } = useWorkforceStore();
  const [activeTab, setActiveTab] = useState<"suggestions" | "logs" | "mcp" | "hub">("suggestions");

  const recentLogs = executionLogs.slice(0, 20);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-teal-500/15 flex items-center justify-center">
            <FlaskConical className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-white">Lyceum AI</h3>
            <p className="text-[9px] text-muted-foreground">Context Engine v1.5</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {activeTab !== "mcp" && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="w-6 h-6 text-muted-foreground hover:text-white"
              onClick={() => getLyceumSuggestions()}
              title="Refresh suggestions"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="w-6 h-6 text-muted-foreground hover:text-white"
            onClick={() => setLyceumPanelOpen(false)}
          >
            <ChevronDown className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5">
        <button
          className={cn(
            "flex-1 text-[10px] py-2.5 font-medium transition-colors relative",
            activeTab === "suggestions"
              ? "text-teal-300"
              : "text-muted-foreground hover:text-white/70"
          )}
          onClick={() => setActiveTab("suggestions")}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Brain className="w-3 h-3" />
            Suggest
            {lyceumSuggestions.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-teal-500/20 text-teal-300 text-[8px] flex items-center justify-center font-mono">
                {lyceumSuggestions.length}
              </span>
            )}
          </div>
          {activeTab === "suggestions" && (
            <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-teal-400 rounded-full" />
          )}
        </button>
        <button
          className={cn(
            "flex-1 text-[10px] py-2.5 font-medium transition-colors relative",
            activeTab === "logs"
              ? "text-teal-300"
              : "text-muted-foreground hover:text-white/70"
          )}
          onClick={() => setActiveTab("logs")}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Clock className="w-3 h-3" />
            Logs
          </div>
          {activeTab === "logs" && (
            <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-teal-400 rounded-full" />
          )}
        </button>
        <button
          className={cn(
            "flex-1 text-[10px] py-2.5 font-medium transition-colors relative",
            activeTab === "hub"
              ? "text-indigo-300"
              : "text-muted-foreground hover:text-white/70"
          )}
          onClick={() => setActiveTab("hub")}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Bell className="w-3 h-3" />
            Hub
          </div>
          {activeTab === "hub" && (
            <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-400 rounded-full" />
          )}
        </button>
        <button
          className={cn(
            "flex-1 text-[10px] py-2.5 font-medium transition-colors relative",
            activeTab === "mcp"
              ? "text-indigo-300"
              : "text-muted-foreground hover:text-white/70"
          )}
          onClick={() => setActiveTab("mcp")}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Terminal className="w-3 h-3" />
            MCP
          </div>
          {activeTab === "mcp" && (
            <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-400 rounded-full" />
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === "hub" ? (
        <AlertDashboard />
      ) : activeTab === "suggestions" ? (
        <SuggestionsTab
          suggestions={lyceumSuggestions}
          onInject={injectSuggestion}
          onRefresh={getLyceumSuggestions}
        />
      ) : activeTab === "logs" ? (
        <LogsTab logs={recentLogs} />
      ) : (
        <div className="flex-1 overflow-hidden">
          <MCPInspector />
        </div>
      )}
    </div>
  );
}

function SuggestionsTab({
  suggestions,
  onInject,
  onRefresh,
}: {
  suggestions: { id: string; text: string; type: string; priority: string }[];
  onInject: (id: string) => void;
  onRefresh: () => void;
}) {
  if (suggestions.length === 0) {
    return (
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <div className="w-10 h-10 rounded-full bg-teal-500/10 flex items-center justify-center mb-3">
            <Brain className="w-5 h-5 text-teal-400" />
          </div>
          <p className="text-xs text-white/70 font-medium mb-1">No suggestions yet</p>
          <p className="text-[10px] text-muted-foreground mb-4">
            Run an A2A pipeline to generate context-aware recommendations.
          </p>
          <Button
            size="sm"
            className="h-7 text-[10px] px-3 bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
            onClick={onRefresh}
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            Analyze History
          </Button>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-2">
        {suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} onInject={onInject} />
        ))}
      </div>
    </ScrollArea>
  );
}

function LogsTab({
  logs,
}: {
  logs: {
    id: string;
    type: string;
    sourceNodeId: string;
    targetNodeId?: string;
    action: string;
    payload: string;
    result: string;
    timestamp: number;
    success: boolean;
  }[];
}) {
  const failedLogs = logs.filter((l) => !l.success);

  return (
    <ScrollArea className="flex-1">
      <div className="p-2">
        {/* Failure summary */}
        {failedLogs.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-2.5 mb-2">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertCircle className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-red-300 font-medium">
                {failedLogs.length} Failure{failedLogs.length !== 1 ? "s" : ""}
              </span>
            </div>
            {failedLogs.slice(0, 2).map((log) => (
              <p key={log.id} className="text-[9px] text-red-400/70 ml-5">
                {log.result}
              </p>
            ))}
          </div>
        )}

        {/* Log entries */}
        {logs.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground">No execution logs yet</p>
          </div>
        ) : (
          logs.map((log) => <LogEntry key={log.id} log={log} />)
        )}
      </div>
    </ScrollArea>
  );
}
