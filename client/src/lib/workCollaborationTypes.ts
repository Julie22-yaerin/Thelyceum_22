/**
 * Work Collaboration Types — The Lyceum
 *
 * Human-to-Human coordination layer:
 *   - Pre-defined work roles (marketing, coding, sales, testing, cold email, etc.)
 *   - Custom roles created by users
 *   - Work cards showing what each person is doing
 *   - Approval/rejection flow with inline chat negotiation
 *   - Responsibility assignments (which human manages which AI department)
 */

import type { Domain } from "@/lib/modelConfig";

// ── Work Roles ───────────────────────────────────────────────────────────────

/** Built-in work roles that come pre-defined */
export const BUILT_IN_ROLES = [
  "marketing",
  "coding",
  "sales",
  "testing",
  "cold_email",
  "design",
  "product",
  "operations",
  "legal",
  "finance",
  "hr",
  "research",
  "support",
  "devops",
  "content",
] as const;

export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

/** A role within the company — can be built-in or custom */
export interface WorkRole {
  id: string;
  /** Display name (e.g. "Marketing", "Cold Email") */
  name: string;
  /** Whether this is a built-in role */
  builtIn: boolean;
  /** Icon identifier for UI display */
  icon: string;
  /** Short description of what this role does */
  description: string;
  /** Which AI domain this role manages (if any) */
  managesDomain: Domain | null;
  /** Which AI agents (by node ID) this role oversees */
  managedAgentIds: string[];
}

// ── Work Cards ───────────────────────────────────────────────────────────────

export type WorkCardStatus =
  | "draft"         // Being written, not submitted
  | "pending"       // Submitted, waiting for approval
  | "approved"      // Approved by all reviewers
  | "rejected"      // Rejected — needs revision
  | "in_progress"   // Approved and work has started
  | "completed"     // Work finished
  | "archived";     // No longer active

export interface WorkCardRevision {
  id: string;
  /** 1-based revision number */
  number: number;
  /** What the person is working on (title) */
  title: string;
  /** Detailed description */
  description: string;
  /** Bullet-point list of tasks */
  tasks: string[];
  /** Expected deliverables */
  deliverables: string[];
  /** Deadline (ISO date string or relative) */
  deadline: string;
  /** Notes/context for reviewers */
  notes: string;
  createdAt: number;
  /** Array of section content — flexible for AI-generated content */
  sections?: WorkCardSection[];
}

export interface WorkCardSection {
  id: string;
  title: string;
  content: string;
  type: "text" | "code" | "data" | "image" | "link";
}

// ── Approval Flow ────────────────────────────────────────────────────────────

export type ApprovalDecision = "approved" | "rejected" | "pending";

export interface ApprovalEntry {
  /** Reviewer's member ID */
  reviewerId: string;
  reviewerName: string;
  reviewerAvatar: string;
  decision: ApprovalDecision;
  /** If rejected, why */
  reason?: string;
  /** Timestamp of decision */
  decidedAt?: number;
  /** Suggested changes (bullet points) */
  suggestedChanges?: string[];
}

// ── Chat Messages (for negotiation) ──────────────────────────────────────────

export interface NegotiationMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  timestamp: number;
  /** If this message references a specific revision */
  referencedRevisionId?: string;
  /** If this message references specific suggested changes */
  referencedChanges?: string[];
}

// ── Work Card (full) ─────────────────────────────────────────────────────────

export interface WorkCard {
  id: string;
  /** Which workspace this belongs to */
  workspaceId: string;
  /** The member who created this work card */
  creatorId: string;
  creatorName: string;
  creatorAvatar: string;
  /** Which role this work card is for */
  roleId: string;
  roleName: string;
  /**
   * "role_claim" = a team member's onboarding request to head this role's
   * department (created by WorkspaceOnboarding, approved via the normal
   * approve/reject/chat flow below). Defaults to "task" for everything else.
   */
  kind?: "role_claim" | "task";
  /** Current status */
  status: WorkCardStatus;
  /** All revisions (latest first) */
  revisions: WorkCardRevision[];
  /** Current active revision index (0 = latest) */
  activeRevisionIndex: number;
  /** Approval entries (one per reviewer) */
  approvals: ApprovalEntry[];
  /** Negotiation chat */
  chat: NegotiationMessage[];
  /** Who needs to review this (member IDs) */
  reviewerIds: string[];
  /** Who this is assigned to (for task tracking) */
  assigneeIds: string[];
  /** Whether this card is pinned/important */
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── Responsibility ───────────────────────────────────────────────────────────

export interface Responsibility {
  /** Member ID */
  memberId: string;
  memberName: string;
  memberAvatar: string;
  /** Which role they are responsible for */
  roleId: string;
  roleName: string;
  /** Which AI domain they manage */
  managedDomain: Domain | null;
  /** Whether they are the primary person for this role */
  isPrimary: boolean;
}

// ── Mock Data Helpers ───────────────────────────────────────────────────────

export const ROLE_ICONS: Record<string, string> = {
  marketing: "📢",
  coding: "💻",
  sales: "📞",
  testing: "🧪",
  cold_email: "📧",
  design: "🎨",
  product: "📋",
  operations: "⚙️",
  legal: "⚖️",
  finance: "💰",
  hr: "👥",
  research: "🔬",
  support: "🎧",
  devops: "🚀",
  content: "✍️",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  marketing: "Campaign strategy, content creation, brand management",
  coding: "Software development, code review, technical architecture",
  sales: "Lead generation, pipeline management, client outreach",
  testing: "QA, test automation, regression testing, bug tracking",
  cold_email: "Email campaigns, prospect outreach, follow-up sequences",
  design: "UI/UX design, prototyping, design systems",
  product: "Product strategy, roadmapping, stakeholder management",
  operations: "Process optimization, resource allocation, workflow design",
  legal: "Contract review, compliance, risk assessment",
  finance: "Budgeting, forecasting, financial reporting",
  hr: "Recruitment, onboarding, performance management",
  research: "Market research, competitive analysis, data collection",
  support: "Customer support, ticketing, knowledge base",
  devops: "CI/CD, infrastructure, monitoring, deployment",
  content: "Copywriting, blog posts, documentation, social media",
};

export const ROLE_DOMAIN_MAP: Record<string, Domain | null> = {
  marketing: null,
  coding: "TECH",
  sales: null,
  testing: null,
  cold_email: null,
  design: null,
  product: null,
  operations: null,
  legal: "LAW",
  finance: "FINANCE",
  hr: null,
  research: null,
  support: null,
  devops: "TECH",
  content: null,
};
