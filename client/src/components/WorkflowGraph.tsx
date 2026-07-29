/**
 * WorkflowGraph — The Lyceum
 *
 * React Flow graph that visualizes the session workflow:
 *   - Each task is a node with status-colored borders
 *   - Dependencies become animated edges (smoothstep style)
 *   - Human→AI flow: amber edges for human tasks, cyan edges for AI triggers
 *   - Active task has teal glow
 *   - Click any node to make it the active task
 *   - MiniMap + Controls for navigation
 */

import { useMemo, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import WorkflowGraphNode from "@/components/WorkflowGraphNode";
import type { WorkflowGraphNodeData } from "@/components/WorkflowGraphNode";
import { useSessionStore, type SelectedTask } from "@/store/useSessionStore";
import { cn } from "@/lib/utils";

// ── Node Types ───────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowGraphNode,
};

// ── Layout Helpers ───────────────────────────────────────────────────────────

/**
 * Arrange task nodes in a top-to-bottom flow layout.
 * Tasks are positioned by their order, with dependencies flowing downward.
 * Tasks at the same "depth" (same number of ancestors in the dependency chain)
 * are placed side by side.
 */
function computeLayout(tasks: SelectedTask[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  
  if (tasks.length === 0) return positions;

  // Compute dependency depth for each task (with cycle protection)
  const depthMap: Record<string, number> = {};
  const computeDepth = (taskId: string, visited: Set<string> = new Set()): number => {
    if (visited.has(taskId)) return 0; // Cycle detected — treat as root
    if (depthMap[taskId] !== undefined) return depthMap[taskId];
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.dependsOn.length === 0) {
      depthMap[taskId] = 0;
      return 0;
    }
    visited.add(taskId);
    const maxDepth = Math.max(...task.dependsOn.map((d) => computeDepth(d, visited))) + 1;
    visited.delete(taskId);
    depthMap[taskId] = maxDepth;
    return maxDepth;
  };

  tasks.forEach((t) => computeDepth(t.id));

  // Group tasks by depth
  const depthGroups: Record<number, string[]> = {};
  Object.entries(depthMap).forEach(([taskId, depth]) => {
    if (!depthGroups[depth]) depthGroups[depth] = [];
    depthGroups[depth].push(taskId);
  });

  const NODE_WIDTH = 220;
  const NODE_HEIGHT = 130;
  const H_GAP = 40;
  const V_GAP = 80;
  const START_Y = 40;

  // Position each depth row
  Object.entries(depthGroups).forEach(([depthStr, taskIds]) => {
    const depth = Number(depthStr);
    const totalWidth = taskIds.length * NODE_WIDTH + (taskIds.length - 1) * H_GAP;
    const startX = -totalWidth / 2 + NODE_WIDTH / 2;

    taskIds.forEach((taskId, i) => {
      // Order within the same depth by their task order
      const sorted = [...taskIds].sort((a, b) => {
        const ta = tasks.find((t) => t.id === a);
        const tb = tasks.find((t) => t.id === b);
        return (ta?.order || 0) - (tb?.order || 0);
      });
      const idx = sorted.indexOf(taskId);
      positions[taskId] = {
        x: startX + idx * (NODE_WIDTH + H_GAP),
        y: START_Y + depth * (NODE_HEIGHT + V_GAP),
      };
    });
  });

  return positions;
}

function getAssigneeType(tasks: SelectedTask[], taskId: string): "human" | "ai" | "mixed" {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return "human";
  if (task.assignedAIs.length === 0) return "human";
  if (task.assignedAIs.length > 0 && task.humanOutput !== undefined) return "mixed";
  return task.assignedAIs.length > 0 ? "mixed" : "human";
}

// ── Edge Styles ───────────────────────────────────────────────────────────────

function getEdgeStyle(sourceStatus: string, targetStatus: string) {
  const bothCompleted = sourceStatus === "completed" && targetStatus === "completed";
  const sourceDone = sourceStatus === "completed";
  const targetWaiting = targetStatus === "not_started";

  if (bothCompleted) {
    return { stroke: "#22c55e", strokeWidth: 2.5, opacity: 0.8 };
  }
  if (sourceDone && targetWaiting) {
    return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
  }
  return { stroke: "rgba(255,255,255,0.12)", strokeWidth: 1.2, opacity: 0.4 };
}

// ── Graph Content (inside ReactFlowProvider) ─────────────────────────────────

function GraphContent({
  tasks,
  activeTaskId,
  onSelectTask,
}: {
  tasks: SelectedTask[];
  activeTaskId: string | null;
  onSelectTask: (id: string) => void;
}) {
  const positions = useMemo(() => computeLayout(tasks), [tasks]);

  const initialNodes: Node<WorkflowGraphNodeData>[] = useMemo(
    () =>
      tasks.map((task) => ({
        id: task.id,
        type: "workflowNode",
        position: positions[task.id] || { x: 0, y: 0 },
        data: {
          label: task.title,
          status: task.status,
          order: task.order,
          isActive: task.id === activeTaskId,
          totalTasks: tasks.length,
          assigneeType: getAssigneeType(tasks, task.id),
          estimatedMinutes: parseInt(task.timeframe) || 30,
        },
        draggable: true,
      })),
    [tasks, positions, activeTaskId]
  );

  const initialEdges: Edge[] = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.dependsOn.map((depId, i) => {
          const depTask = tasks.find((t) => t.id === depId);
          const edgeStyle = getEdgeStyle(depTask?.status || "", task.status);
          return {
            id: `edge-${depId}-${task.id}-${i}`,
            source: depId,
            target: task.id,
            type: "smoothstep",
            animated: task.status === "ai_working" || task.status === "in_progress" || task.status === "awaiting_ai",
            style: { ...edgeStyle, strokeWidth: 2 },
            label: task.humanOutput && task.assignedAIs.length > 0 ? "→ AI" : task.status === "completed" ? "✓" : undefined,
            labelStyle: {
              fontSize: 8,
              fill: "#22c55e",
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
            },
            labelBgStyle: { fill: "#0a0a0e", fillOpacity: 0.8 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
          };
        })
      ),
    [tasks]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes when tasks change (status updates, new tasks, etc.)
  useEffect(() => {
    setNodes(
      tasks.map((task) => ({
        id: task.id,
        type: "workflowNode",
        position: positions[task.id] || { x: 0, y: 0 },
        data: {
          label: task.title,
          status: task.status,
          order: task.order,
          isActive: task.id === activeTaskId,
          totalTasks: tasks.length,
          assigneeType: getAssigneeType(tasks, task.id),
          estimatedMinutes: parseInt(task.timeframe) || 30,
        },
        draggable: true,
      }))
    );

    setEdges(
      tasks.flatMap((task) =>
        task.dependsOn.map((depId, i) => {
          const depTask = tasks.find((t) => t.id === depId);
          const edgeStyle = getEdgeStyle(depTask?.status || "", task.status);
          return {
            id: `edge-${depId}-${task.id}-${i}`,
            source: depId,
            target: task.id,
            type: "smoothstep",
            animated: task.status === "ai_working" || task.status === "in_progress" || task.status === "awaiting_ai",
            style: { ...edgeStyle, strokeWidth: 2 },
            label: task.humanOutput && task.assignedAIs.length > 0 ? "→ AI" : task.status === "completed" ? "✓" : undefined,
            labelStyle: {
              fontSize: 8,
              fill: "#22c55e",
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
            },
            labelBgStyle: { fill: "#0a0a0e", fillOpacity: 0.8 },
            labelBgPadding: [4, 2] as [number, number],
            labelBgBorderRadius: 4,
          };
        })
      )
    );
  }, [tasks, activeTaskId, positions, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectTask(node.id);
    },
    [onSelectTask]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.3, duration: 300 }}
      minZoom={0.4}
      maxZoom={1.5}
      deleteKeyCode={null}
      className="bg-[#08080c]"
      defaultEdgeOptions={{
        type: "smoothstep",
        style: { stroke: "rgba(255,255,255,0.12)", strokeWidth: 1.5 },
      }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={0.8}
        color="rgba(255,255,255,0.04)"
      />
      <Controls
        className="bg-[#0f0f13] border border-white/10 rounded-lg [&>button]:text-muted-foreground [&>button]:hover:text-white [&>button]:hover:bg-white/5 [&>button]:border-white/5"
      />
      <MiniMap
        nodeStrokeColor={(n) =>
          (n.data as any)?.isActive ? "rgba(45,212,191,0.6)" : "rgba(255,255,255,0.15)"
        }
        nodeColor={(n) => {
          const status = (n.data as any)?.status;
          if (status === "completed") return "#166534";
          if (status === "ai_working" || status === "awaiting_ai") return "#1e3a5f";
          if (status === "blocked") return "#7f1d1d";
          if ((n.data as any)?.isActive) return "#115e59";
          return "#1a1a24";
        }}
        nodeBorderRadius={4}
        maskColor="rgba(0,0,0,0.7)"
        className="border border-white/10 rounded-lg"
        style={{ background: "#0f0f13" }}
      />
    </ReactFlow>
  );
}

// ── Main Export ─────────────────────────────────────────────────────────────

interface WorkflowGraphProps {
  tasks: SelectedTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export default function WorkflowGraph({ tasks, activeTaskId, onSelectTask }: WorkflowGraphProps) {
  if (tasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[10px] text-muted-foreground">
        No tasks to display
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <GraphContent
        tasks={tasks}
        activeTaskId={activeTaskId}
        onSelectTask={onSelectTask}
      />
    </ReactFlowProvider>
  );
}
