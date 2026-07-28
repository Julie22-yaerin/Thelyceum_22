export type TaskRiskTier = 'TIER_1_LOW' | 'TIER_2_MED' | 'TIER_3_HIGH';
export type AuditorType = 'LEGAL_POLICY' | 'TECHNICAL' | 'COST_OPTIMIZATION';
export type AuditStatus = 'APPROVED' | 'BOUNCE_BACK' | 'ESCALATE_H2H';
export type AuditorVote = 'PASS' | 'FAIL' | 'FLAG';

export interface TierRule {
  requiredAuditors: AuditorType[];
  maxTokensCap: number;
  timeoutMs: number;
}

export interface AuditTaskPayload {
  taskId: string;
  sourceAgentId: string;
  proposedOutput: string;
  declaredTier?: TaskRiskTier;
  metadata?: {
    containsPII?: boolean;
    isFinancialTransaction?: boolean;
    isExternalAPI?: boolean;
    estimatedTokens?: number;
  };
}

export interface AuditorResult {
  auditorType: AuditorType;
  vote: AuditorVote;
  confidence: number;
  feedback: string;
  tokensUsed: number;
  latencyMs: number;
  timedOut?: boolean;
}

export interface HarnessDecision {
  status: AuditStatus;
  tierUsed: TaskRiskTier;
  totalTokensConsumed: number;
  totalLatencyMs: number;
  auditorResults: AuditorResult[];
  aggregatedFeedback: string[];
}

export const TIER_RULES: Record<TaskRiskTier, TierRule> = {
  TIER_1_LOW: {
    requiredAuditors: ['TECHNICAL'],
    maxTokensCap: 500,
    timeoutMs: 1000,
  },
  TIER_2_MED: {
    requiredAuditors: ['TECHNICAL', 'COST_OPTIMIZATION'],
    maxTokensCap: 1500,
    timeoutMs: 2500,
  },
  TIER_3_HIGH: {
    requiredAuditors: ['LEGAL_POLICY', 'TECHNICAL', 'COST_OPTIMIZATION'],
    maxTokensCap: 4000,
    timeoutMs: 5000,
  },
};
