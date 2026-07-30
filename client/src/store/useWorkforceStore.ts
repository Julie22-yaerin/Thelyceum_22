import { type Edge, type Node } from "@xyflow/react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  WorkRole,
  WorkCard,
  WorkCardRevision,
  ApprovalEntry,
  NegotiationMessage,
  Responsibility,
  WorkCardStatus,
  WorkCardSection,
} from "@/lib/workCollaborationTypes";
import { BUILT_IN_ROLES, ROLE_DESCRIPTIONS, ROLE_DOMAIN_MAP } from "@/lib/workCollaborationTypes";

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

// ── Initial Nodes & Edges for React Flow ─────────────────────────────────────

const TIER_COLORS: Record<PyramidTier, string> = {
  1: "#7c3aed",
  2: "#2563eb",
  3: "#d97706",
};

/**
 * A brand-new workspace starts empty. Agents are created by the user (or
 * registered by a connected AI over MCP) — nothing is invented for them,
 * because a dashboard full of fictional agents is worse than an empty one:
 * it can't be trusted and it can't be acted on.
 */
export function buildInitialNodes(): Node<AgentData>[] {
  return [];
}

/** Layout for agents the user actually creates. */
export function positionForIndex(idx: number): { x: number; y: number } {
  const perRow = 3;
  return { x: 120 + (idx % perRow) * 280, y: 120 + Math.floor(idx / perRow) * 220 };
}

export function buildInitialEdges(): Edge[] {
  return [];
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

  // ── Work Collaboration Actions ────────────────────────────────────────
  workRoles: WorkRole[];
  workCards: WorkCard[];
  responsibilities: Responsibility[];
  showWorkCardBoard: boolean;
  showWorkCardDetail: string | null; // card ID or null
  showWorkflowSetup: boolean;
  showResponsibilityPanel: boolean;
  selectedWorkCardId: string | null;

  setShowWorkCardBoard: (show: boolean) => void;
  setShowWorkCardDetail: (cardId: string | null) => void;
  setShowWorkflowSetup: (show: boolean) => void;
  setShowResponsibilityPanel: (show: boolean) => void;

  initWorkRoles: () => void;
  addCustomRole: (role: WorkRole) => void;
  /** Grant/revoke an AI agent's access to a department workspace. */
  toggleRoleAgent: (roleId: string, agentId: string) => void;

  createWorkCard: (card: Omit<WorkCard, "id" | "createdAt" | "updatedAt" | "status">) => void;
  updateWorkCardStatus: (cardId: string, status: WorkCardStatus) => void;
  addRevision: (cardId: string, revision: Omit<WorkCardRevision, "id" | "number" | "createdAt">) => void;
  submitForApproval: (cardId: string, reviewerIds: string[]) => void;
  approveCard: (cardId: string, reviewerId: string, reviewerName: string, reviewerAvatar: string) => void;
  rejectCard: (cardId: string, reviewerId: string, reviewerName: string, reviewerAvatar: string, reason: string, suggestedChanges: string[]) => void;
  addNegotiationMessage: (cardId: string, message: Omit<NegotiationMessage, "id" | "timestamp">) => void;
  setResponsibility: (memberId: string, memberName: string, memberAvatar: string, roleId: string, roleName: string, isPrimary: boolean) => void;
  removeResponsibility: (memberId: string, roleId: string) => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useWorkforceStore = create<WorkforceStore>()(
  persist(
    (set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────
  nodes: buildInitialNodes(),
  edges: buildInitialEdges(),
  selectedNodeId: null,
  multiplayerUsers: [],
  nodeComments: {},
  executionLogs: [],
  lyceumSuggestions: [],
  domainSpend: { LAW: 0, FINANCE: 0, TECH: 0 },
  selectedModels: {},
  agentDomains: {},
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

  // Work Collaboration
  workRoles: [],
  workCards: [],
  responsibilities: [],
  showWorkCardBoard: false,
  showWorkCardDetail: null,
  showWorkflowSetup: false,
  showResponsibilityPanel: false,
  selectedWorkCardId: null,

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

    // Suggestions are derived from real activity only. If there is nothing to
    // observe yet, say nothing rather than padding the list with an invented
    // recommendation about an agent that doesn't exist.

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

  // ── Work Collaboration Actions ─────────────────────────────────────────

  setShowWorkCardBoard: (show) => set({ showWorkCardBoard: show }),
  setShowWorkCardDetail: (cardId) => set({ showWorkCardDetail: cardId, selectedWorkCardId: cardId }),
  setShowWorkflowSetup: (show) => set({ showWorkflowSetup: show }),
  setShowResponsibilityPanel: (show) => set({ showResponsibilityPanel: show }),

  initWorkRoles: () => {
    const roles: WorkRole[] = BUILT_IN_ROLES.map((role) => ({
      id: `role-${role}`,
      name: role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      builtIn: true,
      icon: role,
      description: ROLE_DESCRIPTIONS[role] || "",
      managesDomain: ROLE_DOMAIN_MAP[role] || null,
      managedAgentIds: [],
    }));
    set({ workRoles: roles });
  },

  addCustomRole: (role) => {
    set({ workRoles: [...get().workRoles, role] });
  },

  toggleRoleAgent: (roleId, agentId) => {
    set({
      workRoles: get().workRoles.map((r) =>
        r.id === roleId
          ? {
              ...r,
              managedAgentIds: r.managedAgentIds.includes(agentId)
                ? r.managedAgentIds.filter((id) => id !== agentId)
                : [...r.managedAgentIds, agentId],
            }
          : r
      ),
    });
  },

  createWorkCard: (cardData) => {
    const card: WorkCard = {
      ...cardData,
      id: `wcard-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "draft",
    };
    set({ workCards: [card, ...get().workCards] });
  },

  updateWorkCardStatus: (cardId, status) => {
    set({
      workCards: get().workCards.map((c) =>
        c.id === cardId ? { ...c, status, updatedAt: Date.now() } : c
      ),
    });
  },

  addRevision: (cardId, revisionData) => {
    const cards = get().workCards;
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;

    const latestNumber = card.revisions.length > 0 ? card.revisions[0].number : 0;
    const newRevision: WorkCardRevision = {
      ...revisionData,
      id: `rev-${cardId}-${latestNumber + 1}`,
      number: latestNumber + 1,
      createdAt: Date.now(),
    };

    set({
      workCards: cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              revisions: [newRevision, ...c.revisions],
              activeRevisionIndex: 0,
              status: "draft",
              approvals: c.approvals.map((a) => ({ ...a, decision: "pending" as const })),
              updatedAt: Date.now(),
            }
          : c
      ),
    });
  },

  submitForApproval: (cardId, reviewerIds) => {
    const { workCards } = get();

    const newApprovals: ApprovalEntry[] = reviewerIds.map((id) => ({
      reviewerId: id,
      reviewerName: id, // Will be resolved by UI component
      reviewerAvatar: "",
      decision: "pending" as const,
    }));

    set({
      workCards: workCards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              status: "pending",
              reviewerIds,
              approvals: newApprovals,
              updatedAt: Date.now(),
            }
          : c
      ),
    });
  },

  approveCard: (cardId, reviewerId, reviewerName, reviewerAvatar) => {
    const cardBefore = get().workCards.find((c) => c.id === cardId);
    const willBeFullyApproved =
      !!cardBefore &&
      cardBefore.approvals.every((a) => (a.reviewerId === reviewerId ? true : a.decision === "approved"));

    set({
      workCards: get().workCards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              approvals: c.approvals.map((a) =>
                a.reviewerId === reviewerId
                  ? { ...a, decision: "approved" as const, decidedAt: Date.now() }
                  : a
              ),
              status: willBeFullyApproved ? "approved" : c.status,
              updatedAt: Date.now(),
            }
          : c
      ),
    });

    // Role-claim cards: once fully approved, materialize the responsibility
    // — the claimant becomes head (primary) of that role's department.
    if (cardBefore?.kind === "role_claim" && willBeFullyApproved) {
      get().setResponsibility(
        cardBefore.creatorId,
        cardBefore.creatorName,
        cardBefore.creatorAvatar,
        cardBefore.roleId,
        cardBefore.roleName,
        true
      );
    }

    get().addAlert({
      severity: "info",
      title: cardBefore?.kind === "role_claim" ? "Role Approved" : "Work Card Approved",
      message: `${reviewerName} approved ${cardBefore?.kind === "role_claim" ? "the role claim" : "work card"} for ${cardBefore?.roleName || "unknown"}`,
    });
  },

  rejectCard: (cardId, reviewerId, reviewerName, reviewerAvatar, reason, suggestedChanges) => {
    set({
      workCards: get().workCards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              approvals: c.approvals.map((a) =>
                a.reviewerId === reviewerId
                  ? {
                      ...a,
                      decision: "rejected" as const,
                      reason,
                      suggestedChanges,
                      decidedAt: Date.now(),
                    }
                  : a
              ),
              status: "rejected",
              updatedAt: Date.now(),
            }
          : c
      ),
    });

    get().addAlert({
      severity: "warning",
      title: "Work Card Rejected",
      message: `${reviewerName} rejected work card: ${reason}`,
    });
  },

  addNegotiationMessage: (cardId, message) => {
    const newMsg: NegotiationMessage = {
      ...message,
      id: `msg-${cardId}-${Date.now()}`,
      timestamp: Date.now(),
    };
    set({
      workCards: get().workCards.map((c) =>
        c.id === cardId
          ? { ...c, chat: [...c.chat, newMsg], updatedAt: Date.now() }
          : c
      ),
    });
  },

  setResponsibility: (memberId, memberName, memberAvatar, roleId, roleName, isPrimary) => {
    const existing = get().responsibilities.findIndex(
      (r) => r.memberId === memberId && r.roleId === roleId
    );

    if (existing >= 0) {
      set({
        responsibilities: get().responsibilities.map((r, i) =>
          i === existing ? { ...r, isPrimary } : r
        ),
      });
    } else {
      const resp: Responsibility = {
        memberId,
        memberName,
        memberAvatar,
        roleId,
        roleName,
        managedDomain: ROLE_DOMAIN_MAP[roleId.replace("role-", "")] || null,
        isPrimary,
      };
      set({ responsibilities: [...get().responsibilities, resp] });
    }
  },

  removeResponsibility: (memberId, roleId) => {
    set({
      responsibilities: get().responsibilities.filter(
        (r) => !(r.memberId === memberId && r.roleId === roleId)
      ),
    });
  },
    }),
    {
      name: "lyceum-workforce",
      // Only the human-coordination layer. Agent nodes/edges/logs are
      // rebuilt from seed on load, so persisting them would freeze stale
      // React Flow positions and bloat localStorage for no benefit.
      partialize: (s) => ({
        workRoles: s.workRoles,
        responsibilities: s.responsibilities,
        workCards: s.workCards,
      }),
    }
  )
);
