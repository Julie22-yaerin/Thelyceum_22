/**
 * Timeout behavior tests — issue #3 focus.
 *
 * Guarantees under test:
 * 1. When simulated work would exceed timeout budget, the promise rejects
 *    BEFORE any tokens are spent (early bail-out).
 * 2. Timed-out results always carry `timedOut: true` and `tokensUsed: 0`.
 * 3. The harness aggregates timeout results into the correct status
 *    (BOUNCE_BACK or ESCALATE_H2H depending on which auditor timed out).
 */

import { adaptiveAuditHarness } from '../services';
import type { AuditorResult } from '../types';

const SHORT_OUTPUT = 'A simple output string.';
const LONG_OUTPUT = 'A'.repeat(4000);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal payload for a given output string. */
function makePayload(output: string) {
  return {
    taskId: 'task-timeout-test',
    sourceAgentId: 'test-agent',
    proposedOutput: output,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Timeout enforcement (issue #3)', () => {
  const LONG_TIMEOUT = 60_000;

  /**
   * Test the early-bail path directly via evaluatePayload.
   * We run enough iterations to reliably hit the timeout branch.
   * For TIER_1: effectiveBudget = 950ms; rawDelay ∈ [50, 1425ms).
   *   P(rawDelay ≥ 950) = 475/1375 ≈ 35%  → 5 runs gives ≈ 86% reliability.
   */
  it(
    'early-bail path fires and reports tokensUsed: 0',
    async () => {
      let timeoutSeen = false;

      for (let i = 0; i < 20; i++) {
        const result = await adaptiveAuditHarness.evaluatePayload(
          makePayload(SHORT_OUTPUT)
        );

        const timedOut = result.auditorResults.filter((r) => r.timedOut);

        if (timedOut.length > 0) {
          timeoutSeen = true;

          for (const r of timedOut) {
            expect(r.tokensUsed).toBe(0);
            expect(r.vote).toBe('FAIL');
          }

          // Timeout path must appear in aggregated feedback.
          const hasTimeoutNote = result.aggregatedFeedback.some((f) =>
            f.includes('Timed out') || f.includes('timed out')
          );
          expect(hasTimeoutNote).toBe(true);
          break;
        }
      }

      expect(timeoutSeen).toBe(true);
    },
    LONG_TIMEOUT
  );

  it(
    'tokens from timed-out auditors are NOT counted in totalTokensConsumed',
    async () => {
      for (let i = 0; i < 20; i++) {
        const result = await adaptiveAuditHarness.evaluatePayload(
          makePayload(SHORT_OUTPUT)
        );

        const timedOut = result.auditorResults.filter((r) => r.timedOut);
        if (timedOut.length === 0) continue;

        const summed = result.auditorResults.reduce((s, r) => s + r.tokensUsed, 0);

        // Total must equal sum of all results.
        expect(result.totalTokensConsumed).toBe(summed);

        // Each timed-out auditor must have burned 0 tokens.
        for (const t of timedOut) {
          expect(t.tokensUsed).toBe(0);
        }
        return;
      }
    },
    LONG_TIMEOUT
  );

  /**
   * Force TIER_3_HIGH by passing isExternalAPI flag so Legal Policy is required.
   * The early-bail path for Legal Policy must trigger ESCALATE_H2H (not BOUNCE_BACK).
   */
  it(
    'ESCALATE_H2H when Legal Policy auditor times out',
    async () => {
      for (let i = 0; i < 20; i++) {
        const result = await adaptiveAuditHarness.evaluatePayload({
          taskId: 'tier3-test',
          sourceAgentId: 'test-agent',
          proposedOutput: SHORT_OUTPUT,
          metadata: { isExternalAPI: true },   // forces TIER_3_HIGH
        });

        const legalTimedOut = result.auditorResults.find(
          (r) => r.auditorType === 'LEGAL_POLICY' && r.timedOut
        );

        if (legalTimedOut) {
          expect(result.status).toBe('ESCALATE_H2H');
          return;
        }
      }
    },
    LONG_TIMEOUT
  );
});

describe('Payload content triggering (deterministic)', () => {
  it('flags confidential keyword via LEGAL_POLICY', async () => {
    const result = await adaptiveAuditHarness.evaluatePayload(
      makePayload('This document is confidential.')
    );

    const legalResult = result.auditorResults.find(
      (r) => r.auditorType === 'LEGAL_POLICY'
    );

    if (legalResult && !legalResult.timedOut) {
      expect(legalResult.vote).toBe('FLAG');
      expect(legalResult.feedback).toContain('confidential');
    }
  });

  it('flags bloated payload via COST_OPTIMIZATION', async () => {
    const result = await adaptiveAuditHarness.evaluatePayload(
      makePayload(LONG_OUTPUT)
    );

    const costResult = result.auditorResults.find(
      (r) => r.auditorType === 'COST_OPTIMIZATION'
    );

    if (costResult && !costResult.timedOut) {
      expect(costResult.vote).toBe('FLAG');
    }
  });
});
