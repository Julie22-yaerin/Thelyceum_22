import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  FlaskConical,
  FolderOpen,
  Play,
  Terminal,
  Users,
  Briefcase,
  ClipboardList,
  Sparkles,
  LayoutGrid,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import AgentNode from "@/components/AgentNode";
import LyceumPanel from "@/components/LyceumPanel";
import NodeInspectorDrawer from "@/components/NodeInspectorDrawer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkforceStore, type AgentData } from "@/store/useWorkforceStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import WorkspaceExplorer from "@/components/WorkspaceExplorer";
import { useMCPClient, type MCPConnectionStatus } from "@/hooks/useMCPClient";
import WorkCardBoard from "@/components/WorkCardBoard";
import WorkCardDetail from "@/components/WorkCardDetail";
import WorkflowSetupModal from "@/components/WorkflowSetupModal";
import ResponsibilityPanel from "@/components/ResponsibilityPanel";

const nodeTypes = { agentNode: AgentNode };

// ── Multiplayer Cursor Overlay ───────────────────────────────────────────────

function MultiplayerCursors() {
  const { multiplayerUsers } = useWorkforceStore();

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {multiplayerUsers.map((user) => (
        <div
          key={user.id}
          className="absolute transition-all duration-700 ease-out"
          style={{
            left: user.cursorPosition?.x ?? 0,
            top: user.cursorPosition?.y ?? 0,
            transform: "translate(-4px, -4px)",
          }}
        >
          <div className="relative">
            {/* Cursor arrow */}
            <svg
              width="16"
              height="20"
              viewBox="0 0 16 20"
              fill="none"
              className="drop-shadow-lg"
            >
              <path
                d="M2 2L13 13H8L5 17L2 2Z"
                fill={user.color}
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="0.5"
              />
            </svg>
            {/* User label */}
            <div
              className="absolute top-4 left-3 px-1.5 py-0.5 rounded text-[9px] font-medium text-ws-text whitespace-nowrap"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Workspace Toggle Button ───────────────────────────────────────────────────

function WorkspaceToggleButton() {
  const { workspacePanelOpen, setWorkspacePanelOpen } = useWorkspaceStore();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 text-[10px] px-1.5",
        workspacePanelOpen
          ? "text-amber-700 bg-amber-50"
          : "text-muted-foreground hover:text-ws-text"
      )}
      onClick={() => setWorkspacePanelOpen(!workspacePanelOpen)}
    >
      <FolderOpen className={cn("w-3 h-3", workspacePanelOpen && "text-amber-700")} />
    </Button>
  );
}

// ── MCP Status Indicator ─────────────────────────────────────────────────────

function MCPStatusBadge({ status }: { status: MCPConnectionStatus }) {
  const colorMap: Record<MCPConnectionStatus, string> = {
    connected: "text-green-700 border-green-200 bg-green-50",
    connecting: "text-yellow-700 border-yellow-200 bg-yellow-50",
    disconnected: "text-ws-text-muted border-ws-border bg-ws-hover",
    error: "text-red-700 border-red-200 bg-red-50",
  };
  const dotMap: Record<MCPConnectionStatus, string> = {
    connected: "bg-green-400",
    connecting: "bg-yellow-400 animate-pulse",
    disconnected: "bg-gray-500",
    error: "bg-red-400",
  };
  const labelMap: Record<MCPConnectionStatus, string> = {
    connected: "MCP Live",
    connecting: "Connecting...",
    disconnected: "MCP Off",
    error: "MCP Error",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors",
        colorMap[status]
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", dotMap[status])} />
      {labelMap[status]}
    </span>
  );
}

// ── Top Command Bar ──────────────────────────────────────────────────────────

function CommandBar({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const {
    runA2APipeline,
    a2aPipelineRunning,
    getTotalTokenBurn,
    multiplayerUsers,
    lyceumPanelOpen,
    setLyceumPanelOpen,
    showWorkCardBoard,
    setShowWorkCardBoard,
    setShowWorkflowSetup,
    showResponsibilityPanel,
    setShowResponsibilityPanel,
  } = useWorkforceStore();
  const mcp = useMCPClient();
  const [mcpConnected, setMcpConnected] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<MCPConnectionStatus>("disconnected");
  const mcpStatusRef = useRef<MCPConnectionStatus>("disconnected");

  // Track MCP status
  useEffect(() => {
    const unsubscribe = () => {
      // Can't subscribe directly, so we poll
    };
    const interval = setInterval(() => {
      const s = mcp.status;
      if (s !== mcpStatusRef.current) {
        mcpStatusRef.current = s;
        setMcpStatus(s);
        setMcpConnected(s === "connected");
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [mcp.status]);

  // Auto-connect to the MCP WebSocket endpoint on mount
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/mcp`;
    mcp.connect(wsUrl).catch(() => {
      // Silently fail — MCP server may not be running
    });
    return () => {
      mcp.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-20 transition-all duration-200",
        collapsed ? "-translate-y-full" : "translate-y-0"
      )}
    >
      <div className="mx-4 mt-3">
        <div className="bg-ws-bg/90 backdrop-blur-xl border border-ws-border rounded-xl shadow-2xl px-4 py-2.5 flex items-center justify-between">
          {/* Left: Pipeline controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-ws-text">
              <FlaskConical className="w-4 h-4 text-teal-700" />
              <span className="text-xs font-semibold tracking-tight">The Lyceum</span>
            </div>
            <div className="h-4 w-px bg-ws-hover mx-1" />
            {/* Simple, non-technical view — departments, missions, progress.
                wouter Link (not <a>) so we navigate client-side. */}
            <Link
              href="/missions"
              className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-[10px] font-medium text-ws-text-soft hover:text-ws-text hover:bg-ws-hover transition-colors"
              title="Departments — the simple view"
            >
              <LayoutGrid className="w-3 h-3" />
              Departments
            </Link>
            <div className="h-4 w-px bg-ws-hover mx-1" />
            <Button
              size="sm"
              className={cn(
                "h-7 text-[10px] px-3 gap-1.5",
                a2aPipelineRunning
                  ? "bg-amber-100 text-amber-700 border border-amber-200"
                  : "bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
              )}
              onClick={runA2APipeline}
              disabled={a2aPipelineRunning}
            >
              <Play className={cn("w-3 h-3", a2aPipelineRunning && "animate-pulse")} />
              {a2aPipelineRunning ? "Running..." : "Run A2A Pipeline"}
            </Button>
            {/* MCP Connection Badge */}
            <MCPStatusBadge status={mcpStatus} />
          </div>

          {/* Center: Stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Coins className="w-3 h-3 text-amber-700" />
              <span>
                Burn:{" "}
                <span className="text-ws-text font-mono">
                  {(getTotalTokenBurn() / 1000).toFixed(1)}k
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Users className="w-3 h-3 text-indigo-700" />
              <span>
                Live:{" "}
                <span className="text-ws-text font-mono">{multiplayerUsers.length}</span>
              </span>
            </div>
          </div>

          {/* Right: Collaboration toggles */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 text-[10px] px-1.5",
                showWorkCardBoard
                  ? "text-indigo-700 bg-indigo-50"
                  : "text-muted-foreground hover:text-ws-text"
              )}
              onClick={() => setShowWorkCardBoard(!showWorkCardBoard)}
              title="Work Cards (H2H Collaboration)"
            >
              <ClipboardList className={cn("w-3 h-3", showWorkCardBoard && "text-indigo-700")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 text-[10px] px-1.5",
                showResponsibilityPanel
                  ? "text-amber-700 bg-amber-50"
                  : "text-muted-foreground hover:text-ws-text"
              )}
              onClick={() => setShowResponsibilityPanel(!showResponsibilityPanel)}
              title="Role Responsibilities"
            >
              <Briefcase className={cn("w-3 h-3", showResponsibilityPanel && "text-amber-700")} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 text-[10px] px-1.5",
                lyceumPanelOpen
                  ? "text-teal-700 bg-teal-50"
                  : "text-muted-foreground hover:text-ws-text"
              )}
              onClick={() => setLyceumPanelOpen(!lyceumPanelOpen)}
              title="Lyceum AI Panel"
            >
              <FlaskConical className={cn("w-3 h-3", lyceumPanelOpen && "text-teal-700")} />
            </Button>
            <WorkspaceToggleButton />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Canvas Content (Inside ReactFlowProvider) ────────────────────────────────

function CanvasContent() {
  const store = useWorkforceStore();
  const [nodes, setNodes, onNodesChange] = useNodesState(store.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(store.edges);
  const [collapsed, setCollapsed] = useState(false);
  const simInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync zustand store changes back to React Flow
  useEffect(() => {
    setNodes(store.nodes as Node[]);
    setEdges(store.edges);
  }, [store.nodes, store.edges, setNodes, setEdges]);

  // Sync local changes back to zustand
  useEffect(() => {
    if (!simInterval.current) {
      simInterval.current = setInterval(() => {
        store.simulateMultiplayerMovement();
      }, 4000);
    }
    return () => {
      if (simInterval.current) clearInterval(simInterval.current);
    };
  }, [store]);

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    store.selectNode(node.id);
  };

  return (
    <div className="relative w-full h-full">
      {/* Command Bar */}
      <CommandBar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute top-3 right-1/2 z-20 translate-x-1/2 w-16 h-5 bg-ws-bg/90 border border-ws-border rounded-b-lg flex items-center justify-center text-muted-foreground hover:text-ws-text transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </button>

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode={null}
        className="bg-ws-subtle"
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "#d4d4d1", strokeWidth: 1.5 },
          labelStyle: { fontSize: 9, fill: "#9b9a97", fontFamily: "Inter, sans-serif" },
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e0e0dd" />
        <Controls
          className="bg-ws-bg border border-ws-border rounded-lg [&>button]:text-muted-foreground [&>button]:hover:text-ws-text [&>button]:hover:bg-ws-hover [&>button]:border-ws-border"
        />
        <MiniMap
          nodeStrokeColor="#d4d4d1"
          nodeColor="#f1f1ef"
          nodeBorderRadius={6}
          maskColor="rgba(55,53,47,0.08)"
          className="border border-ws-border rounded-lg"
          style={{ background: "#ffffff" }}
        />

        {/* Multiplayer cursor overlays */}
        <MultiplayerCursors />
      </ReactFlow>
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────────────────

export default function WorkforceCanvas() {
  const {
    lyceumPanelOpen,
    showWorkCardBoard,
    showWorkCardDetail,
    showResponsibilityPanel,
    showWorkflowSetup,
  } = useWorkforceStore();
  const { workspacePanelOpen } = useWorkspaceStore();

  return (
    <ReactFlowProvider>
      <div className="relative w-full h-full flex">
        {/* Workspace Explorer - collapsible left sidebar */}
        <div
          className={cn(
            "h-full z-20 border-r border-ws-border bg-ws-bg/95 backdrop-blur-xl transition-all duration-300 shrink-0 overflow-hidden",
            workspacePanelOpen ? "w-[340px] opacity-100" : "w-0 opacity-0"
          )}
        >
          {workspacePanelOpen && <WorkspaceExplorer />}
        </div>

        {/* Main canvas area */}
        <div className={cn(
          "flex-1 relative overflow-hidden",
          lyceumPanelOpen ? "mr-[320px]" : "mr-0",
          (showWorkCardBoard || showResponsibilityPanel) ? "mr-[360px]" : ""
        )}>
          <CanvasContent />
        </div>

        {/* Right side panels stack */}
        {showWorkCardBoard && !showWorkCardDetail && (
          <div className="absolute right-0 top-0 h-full w-[340px] z-30 border-l border-ws-border bg-ws-bg/95 backdrop-blur-xl">
            <WorkCardBoard />
          </div>
        )}
        {showWorkCardDetail && (
          <div className="absolute right-0 top-0 h-full w-[340px] z-30 border-l border-ws-border bg-ws-bg/95 backdrop-blur-xl">
            <WorkCardDetail />
          </div>
        )}
        {showResponsibilityPanel && !showWorkCardBoard && !showWorkCardDetail && (
          <div className="absolute right-0 top-0 h-full w-[340px] z-30 border-l border-ws-border bg-ws-bg/95 backdrop-blur-xl">
            <ResponsibilityPanel />
          </div>
        )}

        {/* Lyceum Panel - only when no other right panels are open */}
        {lyceumPanelOpen && !showWorkCardBoard && !showWorkCardDetail && !showResponsibilityPanel && (
          <div className="absolute right-0 top-0 h-full w-[320px] z-20 border-l border-ws-border bg-ws-bg/95 backdrop-blur-xl">
            <LyceumPanel />
          </div>
        )}

        {/* Node Inspector Drawer */}
        <NodeInspectorDrawer />

        {/* AI Workflow Generator modal */}
        {showWorkflowSetup && <WorkflowSetupModal />}
      </div>
    </ReactFlowProvider>
  );
}
