/**
 * WorkflowGraphNode — The Lyceum
 *
 * Custom React Flow node for session tasks in the workflow graph.
 * Shows task title, status, Human/AI indicator, and time estimate.
 * Active node has a teal glow; completed nodes are green; blocked/errors are red.
 */

import { memo } from "react";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  Clock,
  CheckCircle2,
  Loader2,
  Bot,
  Users,
  Play,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface WorkflowGraphNodeData extends Record<string, unknown> {
  label: string;
  status: string;
  order: number;
  isActive: boolean;
  totalTasks: number;
  assigneeType: "human" | "ai" | "mixed";
  estimatedMinutes: number;
}

const STATUS_META: Record<string, { color: string; border: string; icon: React.ElementType; bg: string }> = {
  not_started: {
    color: "text-ws-text-muted",
    border: "border-ws-border",
    bg: "bg-ws-hover",
    icon: Clock,
  },
  in_progress: {
    color: "text-blue-700",
    border: "border-blue-200",
    bg: "bg-blue-500/8",
    icon: Play,
  },
  awaiting_ai: {
    color: "text-amber-700",
    border: "border-amber-200",
    bg: "bg-amber-500/8",
    icon: Bot,
  },
  ai_working: {
    color: "text-cyan-700",
    border: "border-cyan-200",
    bg: "bg-cyan-500/8",
    icon: Loader2,
  },
  completed: {
    color: "text-green-700",
    border: "border-green-200",
    bg: "bg-green-500/8",
    icon: CheckCircle2,
  },
  blocked: {
    color: "text-red-700",
    border: "border-red-200",
    bg: "bg-red-500/8",
    icon: AlertCircle,
  },
};

function WorkflowGraphNode({ data }: NodeProps) {
  const nodeData = data as unknown as WorkflowGraphNodeData;
  const meta = STATUS_META[nodeData.status] || STATUS_META.not_started;
  const StatusIcon = meta.icon;

  return (
    <div
      className={cn(
        "relative w-[200px] rounded-xl border-2 transition-all duration-300 backdrop-blur-sm",
        meta.bg,
        meta.border,
        nodeData.isActive
          ? "border-teal-400/60 shadow-[0_0_16px_rgba(45,212,191,0.2)]"
          : "hover:border-ws-border"
      )}
    >
      {/* Header: order + status badge */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-ws-border">
        <span className="text-[9px] text-muted-foreground font-mono">
          #{nodeData.order}
        </span>
        <div className="flex items-center gap-1">
          <StatusIcon className={cn("w-2.5 h-2.5", meta.color)} />
          <span className={cn("text-[8px] font-medium", meta.color)}>
            {nodeData.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Title */}
      <div className="px-2.5 py-2">
        <p className="text-[10px] font-medium text-ws-text leading-tight line-clamp-2">
          {nodeData.label}
        </p>
      </div>

      {/* Footer: assignee type + time */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-ws-border">
        {nodeData.assigneeType === "human" ? (
          <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-amber-700 border-amber-200 bg-amber-50">
            <Users className="w-2 h-2 mr-0.5" /> Human
          </Badge>
        ) : nodeData.assigneeType === "ai" ? (
          <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-cyan-700 border-cyan-200 bg-cyan-50">
            <Bot className="w-2 h-2 mr-0.5" /> AI
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-purple-700 border-purple-200 bg-purple-50">
            <Users className="w-2 h-2 mr-0.5" /> Mixed
          </Badge>
        )}
        <span className="text-[7px] text-muted-foreground ml-auto">
          {nodeData.estimatedMinutes}m
        </span>
      </div>

      {/* React Flow Handles — top-to-bottom flow */}
      {/* Source on Top (flows downward from completed task) */}
      <Handle
        type="source"
        position={Position.Top}
        className="!w-2 !h-2 !border-2 !border-[#0a0a0e] !bg-teal-400"
      />
      {/* Target on Bottom (receives flow from above) */}
      <Handle
        type="target"
        position={Position.Bottom}
        className="!w-2 !h-2 !border-2 !border-[#0a0a0e] !bg-teal-400"
      />
    </div>
  );
}

export default memo(WorkflowGraphNode);
