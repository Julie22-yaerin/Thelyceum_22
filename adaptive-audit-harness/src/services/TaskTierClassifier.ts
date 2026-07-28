import { type AuditTaskPayload, type TaskRiskTier } from '../types';

export class TaskTierClassifier {
  public static classify(payload: AuditTaskPayload): TaskRiskTier {
    if (payload.declaredTier) {
      return payload.declaredTier;
    }

    const meta = payload.metadata;
    if (meta?.isFinancialTransaction || meta?.containsPII || meta?.isExternalAPI) {
      return 'TIER_3_HIGH';
    }

    const text = payload.proposedOutput.toLowerCase();
    const highRiskKeywords = ['password', 'secret', 'transfer', 'delete database', 'contract', 'pii'];
    if (highRiskKeywords.some(keyword => text.includes(keyword))) {
      return 'TIER_3_HIGH';
    }

    const medRiskKeywords = ['api call', 'query', 'update', 'email draft'];
    if (medRiskKeywords.some(keyword => text.includes(keyword))) {
      return 'TIER_2_MED';
    }

    return 'TIER_1_LOW';
  }
}
