// Re-export everything from the canonical types module.
export * from '../types';

import type { AuditTaskPayload, HarnessDecision } from '../types';

/**
 * Public contract for the audit harness.
 * Implementations must guarantee that no auditor ever exceeds its timeout budget,
 * and that timeout results are always reported with `timedOut: true` and 0 tokens.
 */
export interface AdaptiveAuditHarness {
  evaluatePayload(payload: AuditTaskPayload): Promise<HarnessDecision>;
}
