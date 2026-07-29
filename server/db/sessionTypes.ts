/**
 * Session Types — The Lyceum (Server)
 *
 * Mirrors the client-side session types (from useSessionStore.ts) but
 * serialized for Firestore — no functions, no class instances.
 */

export type TaskCategory =
  | "data_annotation" | "data_collection" | "audio_speech"
  | "explainable_ai" | "content_generation" | "code_development"
  | "market_research" | "customer_support" | "qa_testing"
  | "design" | "operations" | "custom";

export type TaskStatus =
  | "not_started" | "in_progress" | "awaiting_ai"
  | "ai_working" | "completed" | "blocked"
  | "failed" | "awaiting_approval" | "awaiting_clarification";

export interface SessionTaskRoleAI {
  roleName: string;
  agentNodeId: string;
  domain: string;
  requiresHumanOutput: boolean;
}

export interface SessionTaskClarificationQuestion {
  id: string;
  question: string;
  options: { id: string; text: string }[];
  answer: string | null;
  answeredAt?: number;
  autoAnswered?: boolean;
}

export interface SessionTaskApprovalRequest {
  id: string;
  errorContext: string;
  requestedAction: string;
  status: "pending" | "approved" | "rejected";
  failedAttemptNumber: number;
}

export interface SessionTaskData {
  id: string;
  title: string;
  category: TaskCategory;
  description: string;
  source: "ai_suggested" | "custom";
  timeframe: string;
  estimatedMinutes: number;
  assignedAIs: SessionTaskRoleAI[];
  status: TaskStatus;
  order: number;
  dependsOn: string[];
  humanOutput?: string;
  aiOutput?: string;
  aiOutputs?: Record<string, string>;
  // Persisted clarification questions with answers
  clarificationQuestions?: SessionTaskClarificationQuestion[];
  // Persisted retry-limit state
  attemptCount?: number;
  error?: string;
  approvalRequest?: SessionTaskApprovalRequest;
}

export interface SessionAutoAnswerAuditEntry {
  taskId: string;
  taskTitle: string;
  questionId: string;
  question: string;
  defaultAnswer: string;
  timestamp: number;
  batchId: string;
}

export interface TaskSessionData {
  id: string;
  licenseKey: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  confirmed: boolean;
  active: boolean;
  activeTaskId: string | null;
  tasks: SessionTaskData[];
  autoAnswerAuditLog?: SessionAutoAnswerAuditEntry[];
}
