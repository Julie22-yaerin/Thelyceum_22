/**
 * Workspace Store — The Lyceum
 *
 * Multi-tenant company & workspace data model:
 *   Company → Members → Workspaces → Folders → Documents
 *
 * Flow:
 *   1. First user creates a Company (becomes owner)
 *   2. Owner invites members by email
 *   3. Each member gets their own Workspace (personal file area)
 *   4. Workspace contains Folders and Documents
 *   5. Folders can be nested (parentId hierarchy)
 *   6. Documents can be uploaded (mock base64 content)
 */

import { create } from "zustand";
import type { AlertSeverity } from "./useWorkforceStore";

// ── Types ────────────────────────────────────────────────────────────────────

export type MemberRole = "owner" | "admin" | "member";

export interface Company {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: number;
}

export interface WorkspaceMember {
  id: string;
  companyId: string;
  name: string;
  email: string;
  avatar: string;
  role: MemberRole;
  joinedAt: number;
  /** Personal title/headline set during onboarding, e.g. "Growth Lead" */
  title?: string;
  /** Role IDs (from useWorkforceStore.workRoles) this member has claimed as their responsibility */
  claimedRoleIds?: string[];
  /**
   * Has this member completed the name/title/responsibilities onboarding step?
   * True once submitted — independent of whether their role claims are still
   * awaiting teammate approval (see workCards with kind "role_claim").
   */
  onboarded?: boolean;
}

export interface Workspace {
  id: string;
  companyId: string;
  memberId: string;
  label: string;
  createdAt: number;
}

export interface WorkspaceFolder {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null; // null = root level
  createdBy: string;
  createdAt: number;
  documentCount: number;
}

export type DocumentType = "pdf" | "doc" | "xlsx" | "txt" | "md" | "json" | "image" | "code" | "other";

export interface WorkspaceDocument {
  id: string;
  workspaceId: string;
  folderId: string | null; // null = root level
  name: string;
  type: DocumentType;
  size: number; // bytes
  uploadedBy: string;
  uploadedAt: number;
  /** Mock content stored as base64 or plain text */
  content: string;
  description?: string;
}

// ── Document Analysis (Muse) ─────────────────────────────────────────────────

export interface ContentGroup {
  id: string;
  title: string;
  content: string;
  topics: string[];
  suggestedAgentRole?: string;
}

export interface DocumentSection {
  id: string;
  title: string;
  summary: string;
  groups: ContentGroup[];
}

export interface DocAnalysis {
  documentId: string;
  overview: string;
  sections: DocumentSection[];
  analyzedAt: number;
  status: "pending" | "analyzing" | "complete" | "error";
  error?: string;
}

// ── AI Task Spec ─────────────────────────────────────────────────────────────

export interface TaskSpec {
  id: string;
  documentId: string;
  /** Content group ID this task is based on */
  groupId: string;
  /** Pinned content excerpt */
  pinnedContent: string;
  /** What the AI needs to do (bullet points) */
  actionRequirements: string[];
  /** Expected output format (bullet points) */
  outputRequirements: string[];
  /** Input/research requirements (bullet points, optional) */
  inputRequirements: string[];
  /** Target AI agent node ID from the canvas */
  targetAgentId: string;
  /** Whether the task has been dispatched */
  dispatched: boolean;
  createdAt: number;
}

// ── Store Interface ──────────────────────────────────────────────────────────

interface WorkspaceStore {
  // State
  companies: Company[];
  members: WorkspaceMember[];
  workspaces: Workspace[];
  folders: WorkspaceFolder[];
  documents: WorkspaceDocument[];

  /** ID of the currently active company */
  activeCompanyId: string | null;
  /** ID of the currently active workspace */
  activeWorkspaceId: string | null;
  /** Currently open folder (for navigation) */
  openFolderId: string | null;
  /** Breadcrumb path to the current folder */
  folderPath: WorkspaceFolder[];

  /** UI state */
  showCompanySetup: boolean;
  showInviteDialog: boolean;
  showCreateFolder: boolean;
  workspacePanelOpen: boolean;
  /** Member ID currently completing first-login onboarding (name/title/responsibilities), or null */
  pendingOnboardingMemberId: string | null;

  // Document analysis (Muse)
  analyses: Record<string, DocAnalysis>;
  /** Currently selected content group for task composition */
  selectedGroupId: string | null;
  selectedDocumentId: string | null;
  showTaskComposer: boolean;
  showAnalysisPanel: boolean;

  // AI task specs
  taskSpecs: TaskSpec[];

  // Actions
  /** Returns the new founder member's ID so the onboarding wizard can attach a role to them immediately. */
  createCompany: (name: string, ownerName: string) => string;
  setActiveCompany: (companyId: string) => void;

  /** Returns the new member's ID — the caller opens the onboarding wizard for them right after. */
  inviteMember: (name: string, email: string, role: MemberRole) => string;
  removeMember: (memberId: string) => void;
  updateMemberRole: (memberId: string, role: MemberRole) => void;
  completeMemberOnboarding: (memberId: string, title: string, claimedRoleIds: string[]) => void;
  setPendingOnboardingMemberId: (memberId: string | null) => void;

  setActiveWorkspace: (workspaceId: string) => void;
  setShowCompanySetup: (show: boolean) => void;
  setShowInviteDialog: (show: boolean) => void;
  setWorkspacePanelOpen: (open: boolean) => void;

  createFolder: (name: string, parentId?: string | null) => void;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  navigateToFolder: (folderId: string | null) => void;

  uploadDocument: (name: string, type: DocumentType, size: number, content: string, folderId?: string | null) => void;
  deleteDocument: (documentId: string) => void;
  renameDocument: (documentId: string, name: string) => void;

  // Document analysis actions
  setAnalysis: (documentId: string, analysis: DocAnalysis) => void;
  setSelectedGroup: (documentId: string | null, groupId: string | null) => void;
  setShowTaskComposer: (show: boolean) => void;
  setShowAnalysisPanel: (show: boolean) => void;

  // AI task actions
  createTaskSpec: (spec: Omit<TaskSpec, "id" | "createdAt" | "dispatched">) => void;
  dispatchTask: (taskId: string) => void;
  removeTaskSpec: (taskId: string) => void;

  getCurrentCompany: () => Company | undefined;
  getCurrentWorkspace: () => Workspace | undefined;
  getCompanyMembers: () => WorkspaceMember[];
  getFoldersInFolder: (folderId: string | null) => WorkspaceFolder[];
  getDocumentsInFolder: (folderId: string | null) => WorkspaceDocument[];
  getRootFolders: () => WorkspaceFolder[];
  getRootDocuments: () => WorkspaceDocument[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FOLDER_ICONS: Record<string, string> = {
  reports: "📊",
  research: "🔬",
  legal: "⚖️",
  finance: "💰",
  code: "💻",
  data: "📁",
  docs: "📄",
  contracts: "📝",
  invoices: "🧾",
  analytics: "📈",
  default: "📁",
};

const RANDOM_ADJECTIVES = [
  "Quantum", "Nova", "Apex", "Vertex", "Zenith", "Pulse", "Forge",
  "Cascade", "Horizon", "Meridian", "Orion", "Solstice", "Atlas",
];

const RANDOM_NOUNS = [
  "Enterprises", "Corp", "Labs", "Systems", "AI", "Technologies",
  "Solutions", "Ventures", "Partners", "Group", "Collective",
];

// ── Store ────────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────
  companies: [],
  members: [],
  workspaces: [],
  folders: [],
  documents: [],

  activeCompanyId: null,
  activeWorkspaceId: null,
  openFolderId: null,
  folderPath: [],

  showCompanySetup: true, // No company yet — show setup
  showInviteDialog: false,
  showCreateFolder: false,
  workspacePanelOpen: true,
  pendingOnboardingMemberId: null,
  analyses: {},
  selectedGroupId: null,
  selectedDocumentId: null,
  showTaskComposer: false,
  showAnalysisPanel: false,
  taskSpecs: [],

  // ── Company Actions ────────────────────────────────────────────────────

  createCompany: (name, ownerName) => {
    const companyId = `company-${Date.now()}`;
    // Fixed, not Date.now()-based: WorkCardDetail's "current viewer" is
    // hardcoded to this ID (there's no real multi-user login in this
    // single-browser demo) — the founder must have this exact ID or they'll
    // never see the reviewer/approve UI for teammates' role claims.
    const memberId = "member-owner";
    const workspaceId = `workspace-${Date.now()}`;

    const company: Company = {
      id: companyId,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      ownerId: memberId,
      createdAt: Date.now(),
    };

    const owner: WorkspaceMember = {
      id: memberId,
      companyId,
      name: ownerName,
      email: `${ownerName.toLowerCase()}@${company.slug}.lyceum`,
      avatar: "",
      role: "owner",
      joinedAt: Date.now(),
      onboarded: false,
    };

    const workspace: Workspace = {
      id: workspaceId,
      companyId,
      memberId,
      label: `${ownerName}'s Workspace`,
      createdAt: Date.now(),
    };

    // Create default folders
    const defaultFolders: WorkspaceFolder[] = [
      { id: `${workspaceId}-folder-reports`, workspaceId, name: "Reports", parentId: null, createdBy: memberId, createdAt: Date.now(), documentCount: 2 },
      { id: `${workspaceId}-folder-research`, workspaceId, name: "Research", parentId: null, createdBy: memberId, createdAt: Date.now(), documentCount: 1 },
      { id: `${workspaceId}-folder-contracts`, workspaceId, name: "Contracts", parentId: null, createdBy: memberId, createdAt: Date.now(), documentCount: 3 },
    ];

    // Create default documents
    const defaultDocs: WorkspaceDocument[] = [
      { id: `${workspaceId}-doc-1`, workspaceId, folderId: `${workspaceId}-folder-reports`, name: "Q4_Financial_Summary.pdf", type: "pdf", size: 2_450_000, uploadedBy: memberId, uploadedAt: Date.now(), content: "mock-base64-pdf-content-q4-summary" },
      { id: `${workspaceId}-doc-2`, workspaceId, folderId: `${workspaceId}-folder-reports`, name: "Team_Velocity_Report.md", type: "md", size: 12_400, uploadedBy: memberId, uploadedAt: Date.now(), content: "# Team Velocity Report\n\n## Sprint 24\n- Completed: 42 story points\n- Velocity: +12% vs last sprint", description: "Weekly velocity tracking" },
      { id: `${workspaceId}-doc-3`, workspaceId, folderId: `${workspaceId}-folder-research`, name: "Competitor_Analysis.json", type: "json", size: 89_000, uploadedBy: memberId, uploadedAt: Date.now(), content: '{"competitors":["Company A","Company B","Company C"],"market_share":{"Company A":0.34,"Company B":0.28,"Company C":0.15}}' },
      { id: `${workspaceId}-doc-4`, workspaceId, folderId: `${workspaceId}-folder-contracts`, name: "Vendor_Agreement_2024.docx", type: "doc", size: 1_800_000, uploadedBy: memberId, uploadedAt: Date.now(), content: "mock-base64-doc-vendor-agreement" },
      { id: `${workspaceId}-doc-5`, workspaceId, folderId: `${workspaceId}-folder-contracts`, name: "NDA_Template.txt", type: "txt", size: 4_200, uploadedBy: memberId, uploadedAt: Date.now(), content: "This Non-Disclosure Agreement (\"NDA\") is entered into between...", description: "Standard NDA template v2.1" },
      { id: `${workspaceId}-doc-6`, workspaceId, folderId: `${workspaceId}-folder-contracts`, name: "Service_Level_Agreement.xlsx", type: "xlsx", size: 920_000, uploadedBy: memberId, uploadedAt: Date.now(), content: "mock-base64-xlsx-sla" },
    ];

    set({
      companies: [company],
      members: [owner],
      workspaces: [workspace],
      folders: defaultFolders,
      documents: defaultDocs,
      activeCompanyId: companyId,
      activeWorkspaceId: workspaceId,
      // showCompanySetup stays true — the onboarding wizard has more steps
      // (title, responsibilities) after the company name step, and closes
      // itself via setShowCompanySetup(false) once fully complete.
    });

    return memberId;
  },

  setActiveCompany: (companyId) => {
    set({ activeCompanyId: companyId });
  },

  // ── Member Actions ─────────────────────────────────────────────────────

  inviteMember: (name, email, role) => {
    const { activeCompanyId, companies, members, workspaces } = get();
    if (!activeCompanyId) return "";

    const memberId = `member-${Date.now()}-${members.length + 1}`;
    const workspaceId = `workspace-${Date.now()}-${members.length + 1}`;

    const newMember: WorkspaceMember = {
      id: memberId,
      companyId: activeCompanyId,
      name,
      email,
      avatar: "",
      role,
      joinedAt: Date.now(),
      onboarded: false,
    };

    const workspace: Workspace = {
      id: workspaceId,
      companyId: activeCompanyId,
      memberId,
      label: `${name}'s Workspace`,
      createdAt: Date.now(),
    };

    set({
      members: [...members, newMember],
      workspaces: [...workspaces, workspace],
      // Simulate "handing the device" to the newly invited person so they
      // can complete their own onboarding (name tag/title/responsibilities)
      // right away — this is a single-browser demo, there's no separate login.
      pendingOnboardingMemberId: memberId,
      // Don't close the dialog — let the UI show a confirmation first
    });

    return memberId;
  },

  removeMember: (memberId) => {
    const { members, workspaces } = get();
    set({
      members: members.filter((m) => m.id !== memberId),
      workspaces: workspaces.filter((w) => w.memberId !== memberId),
    });
  },

  updateMemberRole: (memberId, role) => {
    set({
      members: get().members.map((m) =>
        m.id === memberId ? { ...m, role } : m
      ),
    });
  },

  completeMemberOnboarding: (memberId, title, claimedRoleIds) => {
    set({
      members: get().members.map((m) =>
        m.id === memberId ? { ...m, title, claimedRoleIds, onboarded: true } : m
      ),
      pendingOnboardingMemberId: null,
    });
  },

  setPendingOnboardingMemberId: (memberId) => set({ pendingOnboardingMemberId: memberId }),

  // ── Workspace Actions ──────────────────────────────────────────────────

  setActiveWorkspace: (workspaceId) => {
    set({ activeWorkspaceId: workspaceId, openFolderId: null, folderPath: [] });
  },

  setShowCompanySetup: (show) => set({ showCompanySetup: show }),
  setShowInviteDialog: (show) => set({ showInviteDialog: show }),
  setWorkspacePanelOpen: (open) => set({ workspacePanelOpen: open }),

  // ── Folder Actions ─────────────────────────────────────────────────────

  createFolder: (name, parentId = null) => {
    const { activeWorkspaceId, members } = get();
    if (!activeWorkspaceId) return;

    const newFolder: WorkspaceFolder = {
      id: `folder-${Date.now()}`,
      workspaceId: activeWorkspaceId,
      name,
      parentId,
      createdBy: members[0]?.id || "unknown",
      createdAt: Date.now(),
      documentCount: 0,
    };

    set({ folders: [...get().folders, newFolder], showCreateFolder: false });
  },

  renameFolder: (folderId, name) => {
    set({
      folders: get().folders.map((f) =>
        f.id === folderId ? { ...f, name } : f
      ),
    });
  },

  deleteFolder: (folderId) => {
    const { folders, documents } = get();
    // Recursively collect ALL descendant folder IDs
    const collectDescendants = (parentId: string): string[] => {
      const children = folders.filter((f) => f.parentId === parentId);
      return children.flatMap((child) => [child.id, ...collectDescendants(child.id)]);
    };
    const allToDelete = new Set([folderId, ...collectDescendants(folderId)]);

    set({
      folders: folders.filter((f) => !allToDelete.has(f.id)),
      documents: documents.filter((d) => !(d.folderId && allToDelete.has(d.folderId))),
    });
  },

  navigateToFolder: (folderId) => {
    const { folders } = get();
    let path: WorkspaceFolder[] = [];

    if (folderId) {
      const current = folders.find((f) => f.id === folderId);
      if (current) {
        // Build path from root to this folder
        const buildPath = (fId: string, acc: WorkspaceFolder[]): WorkspaceFolder[] => {
          const f = folders.find((x) => x.id === fId);
          if (!f) return acc;
          if (f.parentId) return buildPath(f.parentId, [f, ...acc]);
          return [f, ...acc];
        };
        path = buildPath(folderId, []);
      }
    }

    set({ openFolderId: folderId, folderPath: path });
  },

  // ── Document Actions ───────────────────────────────────────────────────

  uploadDocument: (name, type, size, content, folderId = null) => {
    const { activeWorkspaceId, members } = get();
    if (!activeWorkspaceId) return;

    const newDoc: WorkspaceDocument = {
      id: `doc-${Date.now()}`,
      workspaceId: activeWorkspaceId,
      folderId,
      name,
      type,
      size,
      uploadedBy: members[0]?.id || "unknown",
      uploadedAt: Date.now(),
      content,
    };

    set({
      documents: [...get().documents, newDoc],
      // Update folder document count
      folders: get().folders.map((f) =>
        f.id === folderId ? { ...f, documentCount: f.documentCount + 1 } : f
      ),
    });
  },

  deleteDocument: (documentId) => {
    const { documents, folders } = get();
    const doc = documents.find((d) => d.id === documentId);

    set({
      documents: documents.filter((d) => d.id !== documentId),
      // Update folder document count
      folders: doc?.folderId
        ? folders.map((f) =>
            f.id === doc.folderId
              ? { ...f, documentCount: Math.max(0, f.documentCount - 1) }
              : f
          )
        : folders,
    });
  },

  renameDocument: (documentId, name) => {
    set({
      documents: get().documents.map((d) =>
        d.id === documentId ? { ...d, name } : d
      ),
    });
  },

  // ── Document Analysis Actions ────────────────────────────────────────────

  setAnalysis: (documentId, analysis) => {
    set({
      analyses: { ...get().analyses, [documentId]: analysis },
    });
  },

  setSelectedGroup: (documentId, groupId) => {
    set({
      selectedDocumentId: documentId,
      selectedGroupId: groupId,
      showTaskComposer: !!documentId && !!groupId,
    });
  },

  setShowTaskComposer: (show) => set({ showTaskComposer: show }),
  setShowAnalysisPanel: (show) => set({ showAnalysisPanel: show }),

  // ── AI Task Actions ────────────────────────────────────────────────────

  createTaskSpec: (spec) => {
    const newTask: TaskSpec = {
      ...spec,
      id: `task-${Date.now()}`,
      createdAt: Date.now(),
      dispatched: false,
    };
    set({ taskSpecs: [...get().taskSpecs, newTask] });
  },

  dispatchTask: (taskId) => {
    const { taskSpecs } = get();
    const task = taskSpecs.find((t) => t.id === taskId);
    if (!task) return;

    // Mark as dispatched in workspace store
    set({
      taskSpecs: taskSpecs.map((t) =>
        t.id === taskId ? { ...t, dispatched: true } : t
      ),
      showTaskComposer: false,
    });

    // Dynamic import to avoid circular dependency at module level
    import("@/store/useWorkforceStore").then(({ useWorkforceStore }) => {
      try {
        const workforce = useWorkforceStore.getState();
        const agentNode = workforce.nodes.find(
          (n: { id: string }) => n.id === task.targetAgentId
        );

        workforce.addAlert({
          severity: "info" as AlertSeverity,
          title: `Task dispatched to ${agentNode?.data?.label || task.targetAgentId}`,
          message: `Content group "${task.pinnedContent.slice(0, 80)}..." sent for processing`,
          agentId: task.targetAgentId,
        });
      } catch {
        // Workforce store not available
      }
    }).catch(() => {
      // Module not available
    });
  },

  removeTaskSpec: (taskId) => {
    set({
      taskSpecs: get().taskSpecs.filter((t) => t.id !== taskId),
    });
  },

  // ── Query Helpers ──────────────────────────────────────────────────────

  getCurrentCompany: () => {
    const { companies, activeCompanyId } = get();
    return companies.find((c) => c.id === activeCompanyId);
  },

  getCurrentWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get();
    return workspaces.find((w) => w.id === activeWorkspaceId);
  },

  getCompanyMembers: () => {
    const { members, activeCompanyId } = get();
    return members.filter((m) => m.companyId === activeCompanyId);
  },

  getFoldersInFolder: (folderId) => {
    return get().folders.filter((f) => f.parentId === folderId);
  },

  getDocumentsInFolder: (folderId) => {
    return get().documents.filter((d) => d.folderId === folderId);
  },

  getRootFolders: () => {
    return get().folders.filter((f) => f.parentId === null);
  },

  getRootDocuments: () => {
    return get().documents.filter((d) => d.folderId === null);
  },
}));

export { FOLDER_ICONS, RANDOM_ADJECTIVES, RANDOM_NOUNS };
