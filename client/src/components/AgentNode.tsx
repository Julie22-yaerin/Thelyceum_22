import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  Brain,
  ChevronDown,
  Circle,
  Coins,
  MessageCircle,
  Wifi,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkforceStore, type AgentData, type AgentStatus } from "@/store/useWorkforceStore";

// ── Tier Config ──────────────────────────────────────────────────────────────

const TIER_CONFIG = {
  1: { label: "Tier 1: Exec", color: "bg-purple-100 text-purple-700 border-purple-200" } as const,
  2: { label: "Tier 2: Mgr", color: "bg-blue-100 text-blue-700 border-blue-200" } as const,
  3: { label: "Tier 3: Worker", color: "bg-amber-100 text-amber-700 border-amber-200" } as const,
};

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; dot: string }> = {
  AWAKE_WORKING: {
    label: "Working",
    color: "text-green-700 border-green-200 bg-green-50",
    dot: "bg-green-400",
  },
  DROWSY_WARNING: {
    label: "Low Funds",
    color: "text-yellow-700 border-yellow-200 bg-yellow-50",
    dot: "bg-yellow-400",
  },
  ON_STRIKE_ASLEEP: {
    label: "On Strike",
    color: "text-red-700 border-red-200 bg-red-50",
    dot: "bg-red-400",
  },
};

function TokenEnergyBar({ balance, budgetLimit }: { balance: number; budgetLimit: number }) {
  const pct = Math.max(0, Math.min(100, (balance / budgetLimit) * 100));
  const color =
    pct > 20 ? "bg-green-400" : pct > 0 ? "bg-yellow-400" : "bg-red-400";

  return (
    <div className="flex items-center gap-2">
      <Coins className="w-3 h-3 text-muted-foreground shrink-0" />
      <div className="flex-1 h-1.5 bg-ws-hover rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground font-mono w-12 text-right">
        {balance.toLocaleString()} / {budgetLimit.toLocaleString()}
      </span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AgentNode({ id, data }: NodeProps<Node<AgentData>>) {
  const { selectNode, selectedNodeId, multiplayerUsers, nodeComments, rechargeAgentTokens } =
    useWorkforceStore();

  const agentData = data as unknown as AgentData;
  const isSelected = selectedNodeId === id;
  const tierCfg = TIER_CONFIG[agentData.tier];
  const statusCfg = STATUS_CONFIG[agentData.status];
  const connectedUsers = multiplayerUsers.filter((u) => u.activeNodeId === id);
  const comments = nodeComments[id] || [];
  const totalComments = comments.length;

  return (
    <div
      className={cn(
        "relative w-[300px] rounded-xl border transition-all duration-200",
        "bg-ws-bg shadow-lg backdrop-blur-sm",
        isSelected
          ? "border-teal-400/60 shadow-[0_0_20px_rgba(45,212,191,0.15)]"
          : "border-ws-border hover:border-ws-border"
      )}
    >
      {/* Pyramid Tier Badge */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ws-border">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] font-medium px-2 py-0.5 border",
            tierCfg.color
          )}
        >
          <Brain className="w-2.5 h-2.5 mr-1" />
          {tierCfg.label}
        </Badge>

        {/* Comment indicator */}
        {totalComments > 0 && (
          <button
            onClick={() => selectNode(id)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageCircle className="w-3 h-3" />
            <span>{totalComments}</span>
          </button>
        )}
      </div>

      {/* Agent Name + Role */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ws-text tracking-tight">{agentData.label}</h3>
            <p className="text-[11px] text-muted-foreground">{agentData.role}</p>
          </div>
          {/* H2H Presence Avatars */}
          {connectedUsers.length > 0 && (
            <div className="flex -space-x-1.5">
              {connectedUsers.slice(0, 3).map((user) => (
                <div
                  key={user.id}
                  className="w-5 h-5 rounded-full border border-ws-bg flex items-center justify-center text-[8px] font-bold text-ws-text"
                  style={{ backgroundColor: user.color }}
                  title={user.name}
                >
                  {user.name.charAt(0)}
                </div>
              ))}
              {connectedUsers.length > 3 && (
                <div className="w-5 h-5 rounded-full border border-ws-bg bg-ws-hover flex items-center justify-center text-[8px] text-muted-foreground">
                  +{connectedUsers.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Status + Connection Row */}
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
            statusCfg.color
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", statusCfg.dot)} />
          {statusCfg.label}
        </span>

        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border",
            agentData.config.connectionMode === "MCP_SERVER"
              ? "text-cyan-700 border-cyan-200 bg-cyan-50"
              : "text-indigo-700 border-indigo-200 bg-indigo-50"
          )}
        >
          <Wifi className="w-2.5 h-2.5" />
          {agentData.config.connectionMode === "MCP_SERVER" ? "MCP" : "API Key"}
        </span>

        {/* Billing status indicator */}
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded",
            agentData.config.billingStatus === "ACTIVE"
              ? "text-green-700/70"
              : agentData.config.billingStatus === "NO_KEY"
                ? "text-red-700/70"
                : "text-orange-700/70"
          )}
        >
          <Circle
            className={cn(
              "w-2 h-2 fill-current",
              agentData.config.billingStatus === "ACTIVE"
                ? "text-green-700"
                : agentData.config.billingStatus === "NO_KEY"
                  ? "text-red-700"
                  : "text-orange-700"
            )}
          />
          {agentData.config.billingStatus.replace("_", " ")}
        </span>
      </div>

      {/* Token Energy Bar */}
      <div className="px-3 pb-2">
        <TokenEnergyBar balance={agentData.wallet.balance} budgetLimit={agentData.wallet.budgetLimit} />
      </div>

      {/* Quick Actions */}
      <div className="px-3 pb-3 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] px-2 text-muted-foreground hover:text-ws-text hover:bg-ws-hover"
          onClick={() => selectNode(id)}
        >
          <Zap className="w-3 h-3 mr-1" />
          H2A Tune
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] px-2 text-muted-foreground hover:text-ws-text hover:bg-ws-hover"
            >
              <Coins className="w-3 h-3 mr-1" />
              Recharge
              <ChevronDown className="w-2.5 h-2.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="bg-ws-hover border-ws-border text-ws-text min-w-[160px]"
          >
            <DropdownMenuItem
              className="text-xs hover:bg-ws-hover cursor-pointer"
              onClick={() => rechargeAgentTokens(id, 10000)}
            >
              +10k Tokens ($100)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs hover:bg-ws-hover cursor-pointer"
              onClick={() => rechargeAgentTokens(id, 50000)}
            >
              +50k Tokens ($500)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs hover:bg-ws-hover cursor-pointer"
              onClick={() => rechargeAgentTokens(id, 100000)}
            >
              +100k Tokens ($1,000)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* React Flow Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-teal-400 !border-2 !border-ws-bg"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-teal-400 !border-2 !border-ws-bg"
      />
    </div>
  );
}
