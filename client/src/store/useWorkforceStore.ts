import { type Edge, type Node } from "@xyflow/react";
import { create } from "zustand";

// ── Types ────────────────────────────────────────────────────────────────────

export type PyramidTier = 1 | 2 | 3;

export type AgentStatus = "AWAKE_WORKING" | "DROWSY_WARNING" | "ON_STRIKE_ASLEEP";

export type ConnectionMode = "MCP_SERVER" | "DIRECT_API";

export type BillingStatus = "ACTIVE" | "NO_KEY" | "LIMIT_EXCEEDED";

export type Domain = "LAW" | "FINANCE" | "TECH";
export const DOMAINS: Domain[] = ["LAW", "FINANCE", "TECH"];

export interface TokenWallet {
  balance: number; // token count
  budgetLimit: number; // max token budget
  usdEquivalent: number;
}

export interface AgentConfig {
  systemPrompt: string;
  connectionMode: ConnectionMode;
  apiKey?: string;
  mcpServerUrl?: string;
  monthlyBudgetLimit: number;
  billingStatus: BillingStatus;
  /** Domain this agent is assigned to ("LAW" | "FINANCE" | "TECH" | "") */
  domain?: string;
  /** Override model slug for this agent's domain */
  modelOverride?: string;
}

export interface AgentData extends Record<string, unknown> {
  label: string;
  tier: PyramidTier;
  role: string;
  status: AgentStatus;
  wallet: TokenWallet;
  config: AgentConfig;
  commentCount: number;
  connectedUserIds: string[];
}

export interface MultiplayerUser {
  id: string;
  name: string;
  avatar: string;
  color: string;
  activeNodeId: string | null;
  cursorPosition: { x: number; y: number } | null;
}

export interface H2HComment {
  id: string;
  nodeId: string;
  author: string;
  authorAvatar: string;
  text: string;
  timestamp: number;
}

export interface ExecutionLog {
  id: string;
  type: "A2A" | "H2A";
  sourceNodeId: string;
  targetNodeId?: string;
  action: string;
  payload: string;
  result: string;
  timestamp: number;
  success: boolean;
}

export interface LyceumSuggestion {
  id: string;
  text: string;
  type: "H2A" | "A2A" | "H2H";
  priority: "high" | "medium" | "low";
}

// ── Alerts & Notifications ───────────────────────────────────────────────────

export type AlertSeverity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  agentId?: string;
  domain?: Domain;
  timestamp: number;
  dismissed: boolean;
}

// ── Budget Thresholds ────────────────────────────────────────────────────────

export interface MonthlyBudgetCap {
  /** Monthly USD budget cap for this domain */
  cap: number;
  /** Which thresholds (0-1) have already triggered alerts (e.g. [0.5, 0.8]) */
  triggeredThresholds: number[];
}

// ── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_AGENTS: AgentData[] = [
  {
    label: "Orion",
    tier: 1,
    role: "Executive Strategist",
    status: "AWAKE_WORKING",
    wallet: { balance: 85000, budgetLimit: 100000, usdEquivalent: 850 },
    config: {
      systemPrompt: "You are the Executive Master Agent. Decompose high-level strategy into actionable tasks.",
      connectionMode: "DIRECT_API",
      apiKey: "sk-...orion",
      monthlyBudgetLimit: 500,
      billingStatus: "ACTIVE",
    },
    commentCount: 3,
    connectedUserIds: ["user-1", "user-2"],
  },
  {
    label: "Meridian",
    tier: 2,
    role: "Quality Router",
    status: "AWAKE_WORKING",
    wallet: { balance: 62000, budgetLimit: 80000, usdEquivalent: 620 },
    config: {
      systemPrompt: "You are the Manager Agent. Route tasks, enforce quality gates, and flag edge cases.",
      connectionMode: "MCP_SERVER",
      mcpServerUrl: "mcp://meridian.lyceum.internal:8443",
      monthlyBudgetLimit: 300,
      billingStatus: "ACTIVE",
    },
    commentCount: 5,
    connectedUserIds: ["user-3"],
  },
  {
    label: "Scribe",
    tier: 3,
    role: "Data Extraction Specialist",
    status: "AWAKE_WORKING",
    wallet: { balance: 34000, budgetLimit: 50000, usdEquivalent: 340 },
    config: {
      systemPrompt: "Extract structured data from unstructured sources. Return JSON only.",
      connectionMode: "DIRECT_API",
      apiKey: "sk-...scribe",
      monthlyBudgetLimit: 200,
      billingStatus: "ACTIVE",
    },
    commentCount: 1,
    connectedUserIds: [],
  },
  {
    label: "Forge",
    tier: 3,
    role: "Code Generation Specialist",
    status: "DROWSY_WARNING",
    wallet: { balance: 4200, budgetLimit: 50000, usdEquivalent: 42 },
    config: {
      systemPrompt: "Generate production-ready TypeScript code following project standards.",
      connectionMode: "DIRECT_API",
      apiKey: "sk-...forge",
      monthlyBudgetLimit: 200,
      billingStatus: "LIMIT_EXCEEDED",
    },
    commentCount: 2,
    connectedUserIds: [],
  },
  {
    label: "Aegis",
    tier: 2,
    role: "QA & Audit Manager",
    status: "ON_STRIKE_ASLEEP",
    wallet: { balance: 0, budgetLimit: 60000, usdEquivalent: 0 },
    config: {
      systemPrompt: "Audit all outputs for quality, security, and compliance before approval.",
      connectionMode: "MCP_SERVER",
      mcpServerUrl: "mcp://aegis.lyceum.internal:8443",
      monthlyBudgetLimit: 300,
      billingStatus: "NO_KEY",
    },
    commentCount: 7,
    connectedUserIds: ["user-1"],
  },
  {
    label: "Pulse",
    tier: 3,
    role: "Real-time Analytics Agent",
    status: "AWAKE_WORKING",
    wallet: { balance: 28000, budgetLimit: 40000, usdEquivalent: 280 },
    config: {
      systemPrompt: "Monitor real-time data streams and generate anomaly alerts.",
      connectionMode: "DIRECT_API",
      apiKey: "sk-...pulse",
      monthlyBudgetLimit: 150,
      billingStatus: "ACTIVE",
    },
    commentCount: 0,
    connectedUserIds: [],
  },
];

const MOCK_USERS: MultiplayerUser[] = [
  {
    id: "user-1",
    name: "Alex Chen",
    avatar: "",
    color: "#6366f1",
    activeNodeId: "agent-1",
    cursorPosition: { x: 400, y: 120 },
  },
  {
    id: "user-2",
    name: "Sarah Kim",
    avatar: "",
    color: "#f59e0b",
    activeNodeId: "agent-1",
    cursorPosition: { x: 500, y: 150 },
  },
  {
    id: "user-3",
    name: "Marcus Johnson",
    avatar: "",
    color: "#10b981",
    activeNodeId: "agent-2",
    cursorPosition: { x: 350, y: 380 },
  },
];

const MOCK_EXECUTION_LOGS: ExecutionLog[] = [
  {
    id: "log-1",
    type: "A2A",
    sourceNodeId: "agent-1",
    targetNodeId: "agent-2",
    action: "task_decompose",
    payload: '{"task":"Scrape competitor pricing data","subtasks":["Identify URLs","Extract tables","Normalize currency"]}',
    result: "Successfully decomposed into 3 subtasks",
    timestamp: Date.now() - 120000,
    success: true,
  },
  {
    id: "log-2",
    type: "A2A",
    sourceNodeId: "agent-2",
    targetNodeId: "agent-3",
    action: "route_task",
    payload: '{"task":"Extract pricing tables from competitor URLs"}',
    result: "Routed to Scribe (Data Extraction Specialist)",
    timestamp: Date.now() - 90000,
    success: true,
  },
  {
    id: "log-3",
    type: "A2A",
    sourceNodeId: "agent-3",
    targetNodeId: "agent-2",
    action: "data_extracted",
    payload: '{"records":142,"source":"competitor_pricing.html"}',
    result: "Extracted 142 pricing records",
    timestamp: Date.now() - 60000,
    success: true,
  },
  {
    id: "log-4",
    type: "H2A",
    sourceNodeId: "user-1",
    targetNodeId: "agent-4",
    action: "prompt_override",
    payload: '{"instruction":"Use TypeScript strict mode, add JSDoc comments"}',
    result: "Configuration updated",
    timestamp: Date.now() - 30000,
    success: true,
  },
  {
    id: "log-5",
    type: "A2A",
    sourceNodeId: "agent-2",
    targetNodeId: "agent-5",
    action: "qa_request",
    payload: '{"task":"Audit Scribe extraction output for quality"}',
    result: "FAILED - Agent Aegis has insufficient funds (balance: 0)",
    timestamp: Date.now() - 10000,
    success: false,
  },
];

// ── Initial Nodes & Edges for React Flow ─────────────────────────────────────

const TIER_COLORS: Record<PyramidTier, string> = {
  1: "#7c3aed",
  2: "#2563eb",
  3: "#d97706",
};

export function buildInitialNodes(): Node<AgentData>[] {
  // Pyramid layout: Tier 1 top-center, Tier 2 middle width-2, Tier 3 bottom width-3
  const positions: Record<string, { x: number; y: number }> = {
    "agent-1": { x: 500, y: 50 }, // Tier 1 - Exec
    "agent-2": { x: 300, y: 300 }, // Tier 2 - Router
    "agent-5": { x: 700, y: 300 }, // Tier 2 - QA
    "agent-3": { x: 150, y: 550 }, // Tier 3 - Scribe
    "agent-4": { x: 500, y: 550 }, // Tier 3 - Forge
    "agent-6": { x: 850, y: 550 }, // Tier 3 - Pulse
  };

  return MOCK_AGENTS.map((agent, idx) => {
    const id = `agent-${idx + 1}`;
    return {
      id,
      type: "agentNode",
      position: positions[id] || { x: 100 + idx * 200, y: 100 + idx * 150 },
      data: {
        ...agent,
        label: agent.label,
      },
      style: {
        border: `2px solid ${TIER_COLORS[agent.tier]}40`,
        borderRadius: 12,
        background: "transparent",
        padding: 0,
        width: "auto",
        height: "auto",
      },
    };
  });
}

export function buildInitialEdges(): Edge[] {
  return [
    { id: "edge-1-2", source: "agent-1", target: "agent-2", animated: true, style: { stroke: "#7c3aed", strokeWidth: 2 }, label: "strategy" },
    { id: "edge-1-5", source: "agent-1", target: "agent-5", animated: true, style: { stroke: "#7c3aed", strokeWidth: 2 }, label: "audit_req" },
    { id: "edge-2-3", source: "agent-2", target: "agent-3", animated: true, style: { stroke: "#2563eb", strokeWidth: 2 }, label: "extract" },
    { id: "edge-2-4", source: "agent-2", target: "agent-4", animated: true, style: { stroke: "#2563eb", strokeWidth: 2 }, label: "generate" },
    { id: "edge-3-5", source: "agent-3", target: "agent-5", animated: true, style: { stroke: "#d97706", strokeWidth: 1.5 }, label: "qa_check" },
    { id: "edge-4-5", source: "agent-4", target: "agent-5", animated: true, style: { stroke: "#d97706", strokeWidth: 1.5 }, label: "qa_check" },
    { id: "edge-5-1", source: "agent-5", target: "agent-1", animated: true, style: { stroke: "#ef4444", strokeWidth: 1.5 }, label: "report" },
    { id: "edge-2-6", source: "agent-2", target: "agent-6", animated: true, style: { stroke: "#2563eb", strokeWidth: 2 }, label: "monitor" },
  ];
}

// ── Store Interface ──────────────────────────────────────────────────────────

interface WorkforceStore {
  // Graph
  nodes: Node<AgentData>[];
  edges: Edge[];
  selectedNodeId: string | null;

  // Multiplayer
  multiplayerUsers: MultiplayerUser[];

  // Comments
  nodeComments: Record<string, H2HComment[]>;

  // Execution
  executionLogs: ExecutionLog[];

  // Lyceum
  lyceumSuggestions: LyceumSuggestion[];

  // Domain model & spend tracking
  /** Per-domain cumulative USD spend this session */
  domainSpend: Record<Domain, number>;
  /** Per-domain model slug overrides (empty = use default from MODEL_ROUTES) */
  selectedModels: Partial<Record<Domain, string>>;
  /** Mapping of node ID → domain assignment */
  agentDomains: Record<string, Domain>;
  /** Per-domain monthly budget caps */
  budgetCaps: Record<Domain, MonthlyBudgetCap>;

  // Alerts & Notifications
  /** Active alert queue (newest first) */
  alerts: Alert[];

  // Canvas UI state
  a2aPipelineRunning: boolean;
  commandBarCollapsed: boolean;
  lyceumPanelOpen: boolean;
  inspectorDrawerOpen: boolean;
  /** Whether the alert dashboard is visible */
  alertsPanelOpen: boolean;

  // Actions
  setNodes: (nodes: Node<AgentData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  selectNode: (nodeId: string | null) => void;
  setInspectorDrawerOpen: (open: boolean) => void;
  setLyceumPanelOpen: (open: boolean) => void;
  setCommandBarCollapsed: (collapsed: boolean) => void;
  setAlertsPanelOpen: (open: boolean) => void;

  rechargeAgentTokens: (nodeId: string, amount: number) => void;
  addH2HComment: (nodeId: string, author: string, authorAvatar: string, text: string) => void;
  updateAgentConfig: (nodeId: string, configPayload: Partial<AgentConfig>) => void;
  runA2APipeline: () => Promise<void>;
  getLyceumSuggestions: () => void;
  injectSuggestion: (suggestionId: string) => void;
  simulateMultiplayerMovement: () => void;
  getTotalTokenBurn: () => number;

  // Domain model & spend actions
  setDomainModel: (domain: Domain, modelSlug: string) => void;
  recordDomainSpend: (domain: Domain, costUsd: number) => void;
  assignAgentDomain: (nodeId: string, domain: Domain) => void;

  // Alert actions
  addAlert: (alert: Omit<Alert, "id" | "timestamp" | "dismissed">) => void;
  dismissAlert: (alertId: string) => void;
  dismissAllAlerts: () => void;
  checkBudgetThresholds: () => void;
  /** Budget cap per domain (monthly) */
  setBudgetCap: (domain: Domain, cap: number) => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useWorkforceStore = create<WorkforceStore>((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────
  nodes: buildInitialNodes(),
  edges: buildInitialEdges(),
  selectedNodeId: null,
  multiplayerUsers: MOCK_USERS,
  nodeComments: MOCK_AGENTS.reduce(
    (acc, _, idx) => {
      const nodeId = `agent-${idx + 1}`;
      acc[nodeId] = [
        {
          id: `comment-${nodeId}-1`,
          nodeId,
          author: "Alex Chen",
          authorAvatar: "",
          text: `Reviewing ${["Orion","Meridian","Scribe","Forge","Aegis","Pulse"][idx]}'s recent output — looks good but let's tighten the prompt constraints.`,
          timestamp: Date.now() - 3600000,
        },
        {
          id: `comment-${nodeId}-2`,
          nodeId,
          author: "Sarah Kim",
          authorAvatar: "",
          text: "Agreed. I'd also like to increase the token budget by 20k for the next sprint.",
          timestamp: Date.now() - 1800000,
        },
      ];
      return acc;
    },
    {} as Record<string, H2HComment[]>
  ),
  executionLogs: MOCK_EXECUTION_LOGS,
  lyceumSuggestions: [],
  domainSpend: { LAW: 142.3, FINANCE: 89.5, TECH: 215.75 },
  selectedModels: {},
  agentDomains: {
    "agent-1": "LAW",
    "agent-2": "LAW",
    "agent-3": "FINANCE",
    "agent-4": "TECH",
    "agent-5": "FINANCE",
    "agent-6": "TECH",
  },
  budgetCaps: {
    LAW: { cap: 500, triggeredThresholds: [] },
    FINANCE: { cap: 400, triggeredThresholds: [] },
    TECH: { cap: 600, triggeredThresholds: [] },
  },
  alerts: [],
  a2aPipelineRunning: false,
  commandBarCollapsed: false,
  lyceumPanelOpen: true,
  inspectorDrawerOpen: false,
  alertsPanelOpen: false,

  // ── Actions ────────────────────────────────────────────────────────────

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, inspectorDrawerOpen: !!nodeId }),
  setInspectorDrawerOpen: (open) => set({ inspectorDrawerOpen: open }),
  setLyceumPanelOpen: (open) => set({ lyceumPanelOpen: open }),
  setCommandBarCollapsed: (collapsed) => set({ commandBarCollapsed: collapsed }),

  setAlertsPanelOpen: (open) => set({ alertsPanelOpen: open }),

  // ── Domain Model & Spend Actions ────────────────────────────────────────

  setDomainModel: (domain, modelSlug) => {
    set({
      selectedModels: { ...get().selectedModels, [domain]: modelSlug },
    });
  },

  recordDomainSpend: (domain, costUsd) => {
    set({
      domainSpend: {
        ...get().domainSpend,
        [domain]: (get().domainSpend[domain] || 0) + costUsd,
      },
    });
  },

  assignAgentDomain: (nodeId, domain) => {
    set({
      agentDomains: { ...get().agentDomains, [nodeId]: domain },
      nodes: get().nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, domain } } }
          : n
      ),
    });
  },

  // ── Alert Actions ────────────────────────────────────────────────────────

  addAlert: (alert) => {
    const newAlert: Alert = {
      ...alert,
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      dismissed: false,
    };
    set({ alerts: [newAlert, ...get().alerts].slice(0, 50) });

    // Also trigger browser notification if supported
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`[${alert.severity.toUpperCase()}] ${alert.title}`, {
        body: alert.message,
        silent: false,
      });
    }
  },

  dismissAlert: (alertId) => {
    set({
      alerts: get().alerts.map((a) =>
        a.id === alertId ? { ...a, dismissed: true } : a
      ),
    });
  },

  dismissAllAlerts: () => {
    set({
      alerts: get().alerts.map((a) => ({ ...a, dismissed: true })),
    });
  },

  checkBudgetThresholds: () => {
    const { domainSpend, budgetCaps } = get();
    const domains = DOMAINS;
    const labelMap: Record<Domain, string> = { LAW: "Law", FINANCE: "Finance", TECH: "Tech" };

    // Simple local formatter (avoid import)
    const fmt = (n: number): string => {
      if (n >= 100) return `$${n.toFixed(0)}`;
      if (n >= 1) return `$${n.toFixed(2)}`;
      if (n >= 0.01) return `¢${(n * 100).toFixed(1)}`;
      return `¢${(n * 100).toFixed(2)}`;
    };

    for (const domain of domains) {
      const spend = domainSpend[domain] || 0;
      const capData = budgetCaps[domain];
      if (!capData || capData.cap <= 0) continue;

      const ratio = spend / capData.cap;
      const THRESHOLDS = [0.5, 0.8, 1.0];

      for (const threshold of THRESHOLDS) {
        if (ratio >= threshold && !capData.triggeredThresholds.includes(threshold)) {
          const severity: AlertSeverity =
            threshold >= 1.0 ? "critical" : threshold >= 0.8 ? "warning" : "info";
          const pct = Math.round(threshold * 100);

          get().addAlert({
            severity,
            title: `${domain} Budget ${pct}% Used`,
            message: `${labelMap[domain]} has consumed ${fmt(spend)} of $${capData.cap} monthly cap.${threshold >= 1.0 ? " ALL OPERATIONS HALTED." : ""}`,
            domain,
          });

          // Mark threshold as triggered
          set({
            budgetCaps: {
              ...get().budgetCaps,
              [domain]: {
                ...capData,
                triggeredThresholds: [...capData.triggeredThresholds, threshold],
              },
            },
          });
        }
      }
    }
  },

  setBudgetCap: (domain, cap) => {
    set({
      budgetCaps: {
        ...get().budgetCaps,
        [domain]: { cap, triggeredThresholds: [] },
      },
    });
  },

  rechargeAgentTokens: (nodeId, amount) => {
    const { nodes } = get();
    const updatedNodes = nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const newBalance = Math.min(n.data.wallet.balance + amount, n.data.wallet.budgetLimit);
      const newUsd = Math.round((newBalance / n.data.wallet.budgetLimit) * n.data.wallet.usdEquivalent);
      const status: AgentStatus =
        newBalance <= 0
          ? "ON_STRIKE_ASLEEP"
          : newBalance <= n.data.wallet.budgetLimit * 0.2
            ? "DROWSY_WARNING"
            : "AWAKE_WORKING";

      return {
        ...n,
        data: {
          ...n.data,
          status,
          wallet: { ...n.data.wallet, balance: newBalance, usdEquivalent: newUsd },
        },
      };
    });
    set({ nodes: updatedNodes });
  },

  addH2HComment: (nodeId, author, authorAvatar, text) => {
    const { nodeComments } = get();
    const comments = nodeComments[nodeId] || [];
    const newComment: H2HComment = {
      id: `comment-${nodeId}-${Date.now()}`,
      nodeId,
      author,
      authorAvatar,
      text,
      timestamp: Date.now(),
    };
    set({
      nodeComments: { ...nodeComments, [nodeId]: [...comments, newComment] },
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, commentCount: n.data.commentCount + 1 } } : n
      ),
    });
  },

  updateAgentConfig: (nodeId, configPayload) => {
    const { nodes } = get();
    set({
      nodes: nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...configPayload } } }
          : n
      ),
    });
  },

  runA2APipeline: async () => {
    set({ a2aPipelineRunning: true });
    const { nodes } = get();
    const newLogs: ExecutionLog[] = [];

    // Simulate A2A pipeline execution with delays
    const steps = [
      { from: "agent-1", to: "agent-2", action: "delegate", payload: "Market research & analysis pipeline" },
      { from: "agent-2", to: "agent-3", action: "route", payload: "Extract competitor pricing data" },
      { from: "agent-3", to: "agent-2", action: "return", payload: "142 records extracted" },
      { from: "agent-2", to: "agent-5", action: "qa_request", payload: "Audit extraction quality" },
      { from: "agent-5", to: "agent-1", action: "qa_report", payload: "98.5% accuracy - PASSED" },
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const step = steps[i];
      const targetNode = nodes.find((n) => n.id === step.to);
      const success = targetNode ? targetNode.data.status !== "ON_STRIKE_ASLEEP" : false;

      newLogs.push({
        id: `pipeline-log-${Date.now()}-${i}`,
        type: "A2A" as const,
        sourceNodeId: step.from,
        targetNodeId: step.to,
        action: step.action,
        payload: JSON.stringify({ task: step.payload }),
        result: success
          ? `Executed: ${step.payload}`
          : `FAILED - ${targetNode?.data.label || "Unknown"} is on strike`,
        timestamp: Date.now(),
        success,
      });
    }

    set({
      executionLogs: [...newLogs, ...get().executionLogs].slice(0, 50),
      a2aPipelineRunning: false,
    });

    // Generate lyceum suggestions after pipeline
    get().getLyceumSuggestions();
  },

  getLyceumSuggestions: () => {
    const { executionLogs, nodes } = get();
    const failedLogs = executionLogs.filter((l) => !l.success);
    const suggestions: LyceumSuggestion[] = [];

    // Generate 2-3 context-aware suggestions based on execution history
    const sleepingAgents = nodes.filter((n) => n.data.status === "ON_STRIKE_ASLEEP");
    if (sleepingAgents.length > 0) {
      suggestions.push({
        id: "sug-sleep",
        text: `${sleepingAgents[0].data.label} is on strike (¥0 balance). Suggested H2A Step: Recharge tokens before continuing A2A workflows.`,
        type: "H2A",
        priority: "high",
      });
    }

    if (failedLogs.length > 0) {
      suggestions.push({
        id: "sug-failed",
        text: `Pipeline had ${failedLogs.length} failure(s). Suggested H2A Step: Recharge agent tokens and retry.`,
        type: "H2A",
        priority: "high",
      });
    } else {
      const recentA2A = executionLogs.filter((l) => l.type === "A2A" && l.success).slice(0, 3);
      if (recentA2A.length >= 2) {
        suggestions.push({
          id: "sug-qa",
          text: "A2A Data Extraction Complete. Suggested H2A Step: Run QA Audit on extracted data before publishing.",
          type: "H2A",
          priority: "medium",
        });
      }
    }

    if (suggestions.length < 3) {
      suggestions.push({
        id: "sug-review",
        text: "H2H Review Needed: Meridian has 5 unresolved comments. Suggested H2H Step: Resolve discussion threads before next deployment.",
        type: "H2H",
        priority: "medium",
      });
    }

    set({ lyceumSuggestions: suggestions.slice(0, 3) });
  },

  injectSuggestion: (suggestionId) => {
    // This would inject the suggestion text into the Master Agent's prompt
    const { lyceumSuggestions } = get();
    const suggestion = lyceumSuggestions.find((s) => s.id === suggestionId);
    if (!suggestion) return;

    // Simulate injection by adding an execution log
    const newLog: ExecutionLog = {
      id: `inject-${Date.now()}`,
      type: "H2A",
      sourceNodeId: "user-1",
      targetNodeId: "agent-1",
      action: "suggestion_injected",
      payload: JSON.stringify({ suggestion: suggestion.text }),
      result: "Suggestion injected into Master Agent context",
      timestamp: Date.now(),
      success: true,
    };
    set({
      executionLogs: [newLog, ...get().executionLogs].slice(0, 50),
    });
  },

  simulateMultiplayerMovement: () => {
    const { multiplayerUsers, nodes } = get();
    const updatedUsers = multiplayerUsers.map((u) => {
      const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
      return {
        ...u,
        activeNodeId: randomNode.id,
        cursorPosition: {
          x: randomNode.position.x + Math.random() * 100 - 50,
          y: randomNode.position.y + Math.random() * 80 - 40,
        },
      };
    });
    set({ multiplayerUsers: updatedUsers });
  },

  getTotalTokenBurn: () => {
    const { nodes } = get();
    return nodes.reduce((sum, n) => sum + (n.data.wallet.budgetLimit - n.data.wallet.balance), 0);
  },
}));
