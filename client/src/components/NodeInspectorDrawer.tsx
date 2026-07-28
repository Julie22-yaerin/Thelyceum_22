import { X, Send, Key, MessageCircle, Wifi, Zap, Coins, BoxSelect } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import ModelSelector from "@/components/ModelSelector";
import {
  useWorkforceStore,
  type AgentConfig,
  type AgentData,
  type Domain,
  type H2HComment,
} from "@/store/useWorkforceStore";

// ── H2A Chat Tab ─────────────────────────────────────────────────────────────

function H2AChatTab({ data, nodeId }: { data: AgentData; nodeId: string }) {
  const { updateAgentConfig } = useWorkforceStore();
  const [messages, setMessages] = useState<
    { role: "user" | "agent"; text: string }[]
  >([
    {
      role: "agent",
      text: `Hello, I'm ${data.label}. I'm currently working as a ${data.role}. How can I help you tune my behavior?`,
    },
    { role: "user", text: `Override prompt: Focus on speed over accuracy for the next batch.` },
    { role: "agent", text: `Understood. I'll prioritize throughput for the next workflow cycle. Current settings:\n- Accuracy target: lowered to 85%\n- Max concurrency: increased to 8` },
  ]);
  const [input, setInput] = useState("");
  const [promptOverride, setPromptOverride] = useState(data.config.systemPrompt);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: "user", text: input.trim() }]);
    setInput("");

    // Simulate agent response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: `Processing "${input.trim()}". Configuration updated.`,
        },
      ]);
    }, 600);
  };

  const handleApplyPrompt = () => {
    updateAgentConfig(nodeId, { systemPrompt: promptOverride });
    setMessages((prev) => [
      ...prev,
      { role: "user", text: `System prompt updated: "${promptOverride.substring(0, 60)}..."` },
      { role: "agent", text: "System prompt applied. Ready for next task." },
    ]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat messages */}
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2 text-sm",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "agent" && (
                <Avatar className="w-6 h-6 shrink-0">
                  <AvatarFallback className="text-[9px] bg-teal-500/20 text-teal-300">
                    {data.label.charAt(0)}
                  </AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed",
                  msg.role === "user"
                    ? "bg-teal-500/15 text-teal-200 border border-teal-500/20"
                    : "bg-white/5 text-gray-300 border border-white/10"
                )}
              >
                {msg.text}
              </div>
              {msg.role === "user" && (
                <Avatar className="w-6 h-6 shrink-0">
                  <AvatarFallback className="text-[9px] bg-purple-500/20 text-purple-300">
                    U
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Prompt override area */}
      <div className="px-4 py-2 border-t border-white/5">
        <p className="text-[10px] text-muted-foreground mb-1">System Prompt Override</p>
        <div className="flex gap-1.5">
          <Input
            value={promptOverride}
            onChange={(e) => setPromptOverride(e.target.value)}
            className="h-7 text-[10px] bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10"
            onClick={handleApplyPrompt}
            title="Apply prompt override"
          >
            <Zap className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Chat input */}
      <div className="px-4 py-3 border-t border-white/5 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type an H2A instruction..."
          className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <Button
          size="sm"
          className="h-8 w-8 p-0 bg-teal-500 hover:bg-teal-600 text-white"
          onClick={handleSend}
        >
          <Send className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Billing Config Tab ───────────────────────────────────────────────────────

function BillingConfigTab({ data, nodeId }: { data: AgentData; nodeId: string }) {
  const { updateAgentConfig, agentDomains } = useWorkforceStore();
  const [apiKey, setApiKey] = useState(data.config.apiKey || "");
  const [mcpUrl, setMcpUrl] = useState(data.config.mcpServerUrl || "");
  const [monthlyLimit, setMonthlyLimit] = useState(data.config.monthlyBudgetLimit.toString());
  const [connectionMode, setConnectionMode] = useState(data.config.connectionMode);
  const [showApiKey, setShowApiKey] = useState(false);

  const handleSave = () => {
    updateAgentConfig(nodeId, {
      apiKey,
      mcpServerUrl: mcpUrl,
      monthlyBudgetLimit: Number(monthlyLimit),
      connectionMode,
      billingStatus: apiKey ? "ACTIVE" : mcpUrl ? "ACTIVE" : "NO_KEY",
    });
  };

  // Determine this agent's domain for the ModelSelector
  const agentDomain: Domain | undefined = agentDomains[nodeId];

  return (
    <div className="p-4 space-y-5">
      {/* Model Selector — Domain Model Configuration */}
      {agentDomain && (
        <div className="mb-5">
          <p className="text-xs font-medium text-white/80 mb-2 flex items-center gap-1.5">
            <BoxSelect className="w-3 h-3 text-indigo-400" />
            Model Configuration
          </p>
          <ModelSelector nodeId={nodeId} domain={agentDomain} />
        </div>
      )}

      <Separator className="bg-white/5" />
      {/* Connection Mode */}
      <div>
        <p className="text-xs font-medium text-white/80 mb-2 flex items-center gap-1.5">
          <Wifi className="w-3 h-3 text-teal-400" />
          Connection Mode
        </p>
        <div className="flex gap-2">
          <Button
            variant={connectionMode === "DIRECT_API" ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 text-[10px]",
              connectionMode === "DIRECT_API"
                ? "bg-teal-500/20 text-teal-300 border-teal-500/30"
                : "bg-white/5 text-muted-foreground border-white/10"
            )}
            onClick={() => setConnectionMode("DIRECT_API")}
          >
            <Key className="w-3 h-3 mr-1" />
            Direct API
          </Button>
          <Button
            variant={connectionMode === "MCP_SERVER" ? "default" : "outline"}
            size="sm"
            className={cn(
              "h-8 text-[10px]",
              connectionMode === "MCP_SERVER"
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
                : "bg-white/5 text-muted-foreground border-white/10"
            )}
            onClick={() => setConnectionMode("MCP_SERVER")}
          >
            <Wifi className="w-3 h-3 mr-1" />
            MCP Server
          </Button>
        </div>
      </div>

      {connectionMode === "DIRECT_API" && (
        <div>
          <p className="text-xs font-medium text-white/80 mb-2 flex items-center gap-1.5">
            <Key className="w-3 h-3 text-indigo-400" />
            API Key
          </p>
          <div className="flex gap-1.5">
            <Input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... (masked)"
              className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50 flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-[10px] text-muted-foreground hover:text-white"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? "Hide" : "Show"}
            </Button>
          </div>
        </div>
      )}

      {connectionMode === "MCP_SERVER" && (
        <div>
          <p className="text-xs font-medium text-white/80 mb-2 flex items-center gap-1.5">
            <Wifi className="w-3 h-3 text-cyan-400" />
            MCP Server URL
          </p>
          <Input
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            placeholder="mcp://server.internal:8443"
            className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
          />
        </div>
      )}

      {/* Monthly Budget */}
      <div>
        <p className="text-xs font-medium text-white/80 mb-2 flex items-center gap-1.5">
          <Coins className="w-3 h-3 text-amber-400" />
          Monthly Budget Limit ($)
        </p>
        <Input
          type="number"
          value={monthlyLimit}
          onChange={(e) => setMonthlyLimit(e.target.value)}
          placeholder="500"
          className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Current Billing Status */}
      <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
        <p className="text-[10px] text-muted-foreground mb-1">Current Billing Status</p>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            data.config.billingStatus === "ACTIVE"
              ? "text-green-400 border-green-500/30"
              : data.config.billingStatus === "NO_KEY"
                ? "text-red-400 border-red-500/30"
                : "text-orange-400 border-orange-500/30"
          )}
        >
          {data.config.billingStatus.replace("_", " ")}
        </Badge>
      </div>

      <Button
        className="w-full h-8 text-xs bg-teal-500 hover:bg-teal-600 text-white"
        onClick={handleSave}
      >
        Save Configuration
      </Button>
    </div>
  );
}

// ── H2H Discussion Tab ───────────────────────────────────────────────────────

function H2HDiscussionTab({ nodeId, data }: { nodeId: string; data: AgentData }) {
  const { nodeComments, addH2HComment } = useWorkforceStore();
  const comments = nodeComments[nodeId] || [];
  const [commentText, setCommentText] = useState("");

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addH2HComment(nodeId, "You (Founder)", "", commentText.trim());
    setCommentText("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-white/5">
        <p className="text-[10px] text-muted-foreground">
          {comments.length} comment{comments.length !== 1 ? "s" : ""} · H2H discussion about{" "}
          <span className="text-white/70">{data.label}</span>
        </p>
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-3">
          {comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
          {comments.length === 0 && (
            <div className="text-center py-8">
              <MessageCircle className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No comments yet. Start the discussion.</p>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="px-4 py-3 border-t border-white/5 flex gap-2">
        <Input
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Leave feedback for your team..."
          className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-muted-foreground/50"
          onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
        />
        <Button
          size="sm"
          className="h-8 w-8 p-0 bg-teal-500 hover:bg-teal-600 text-white"
          onClick={handleAddComment}
        >
          <Send className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function CommentCard({ comment }: { comment: H2HComment }) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar className="w-5 h-5">
          <AvatarFallback className="text-[8px] bg-purple-500/20 text-purple-300">
            {comment.author.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <span className="text-[10px] font-medium text-white/70">{comment.author}</span>
        <span className="text-[9px] text-muted-foreground ml-auto">
          {formatRelativeTime(comment.timestamp)}
        </span>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">{comment.text}</p>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Main Drawer ──────────────────────────────────────────────────────────────

export default function NodeInspectorDrawer() {
  const { selectedNodeId, nodes, setInspectorDrawerOpen, inspectorDrawerOpen } = useWorkforceStore();
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNodeId || !selectedNode) return null;

  const data = selectedNode.data;

  return (
    <>
      {/* Backdrop */}
      {inspectorDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setInspectorDrawerOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed right-0 top-0 h-full w-[420px] z-50 border-l border-white/10",
          "bg-[#0f0f13] shadow-2xl transition-transform duration-300 ease-out",
          inspectorDrawerOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-teal-500/15 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{data.label}</h3>
              <p className="text-[10px] text-muted-foreground">{data.role}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-white"
            onClick={() => setInspectorDrawerOpen(false)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="h2a-chat" className="flex flex-col h-[calc(100%-52px)]">
          <div className="px-4 pt-3 pb-0 border-b border-white/5">
            <TabsList className="bg-white/[0.03] h-8 w-full">
              <TabsTrigger
                value="h2a-chat"
                className="text-[10px] flex-1 data-[state=active]:bg-white/10 data-[state=active]:text-white"
              >
                <Zap className="w-3 h-3 mr-1" />
                H2A Chat
              </TabsTrigger>
              <TabsTrigger
                value="billing"
                className="text-[10px] flex-1 data-[state=active]:bg-white/10 data-[state=active]:text-white"
              >
                <Key className="w-3 h-3 mr-1" />
                Config
              </TabsTrigger>
              <TabsTrigger
                value="discussion"
                className="text-[10px] flex-1 data-[state=active]:bg-white/10 data-[state=active]:text-white"
              >
                <MessageCircle className="w-3 h-3 mr-1" />
                H2H ({data.commentCount})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="h2a-chat" className="flex-1 m-0 overflow-hidden">
            <H2AChatTab data={data} nodeId={selectedNodeId} />
          </TabsContent>
          <TabsContent value="billing" className="flex-1 m-0 overflow-auto">
            <BillingConfigTab data={data} nodeId={selectedNodeId} />
          </TabsContent>
          <TabsContent value="discussion" className="flex-1 m-0 overflow-hidden">
            <H2HDiscussionTab nodeId={selectedNodeId} data={data} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
