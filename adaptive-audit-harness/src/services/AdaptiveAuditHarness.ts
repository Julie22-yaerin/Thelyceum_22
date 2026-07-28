import { TIER_RULES } from '../types';
import type {
  AdaptiveAuditHarness,
  AuditTaskPayload,
  AuditorResult,
  HarnessDecision,
  AuditorType,
  AuditorVote,
} from './AdaptiveAuditHarness.types';
import { TaskTierClassifier } from './TaskTierClassifier';

export * from './AdaptiveAuditHarness.types';

// ── Internal mock types (not exported in the public contract) ─────────────────

interface SimulatedCheck {
  vote: AuditorVote;
  feedback: string;
  tokensUsed: number;
}

// ── Simulated auditor inspection logic ───────────────────────────────────────

function runInspection(auditorType: AuditorType, output: string): SimulatedCheck {
  if (auditorType === 'LEGAL_POLICY' && output.includes('confidential')) {
    return {
      vote: 'FLAG',
      feedback: 'Potential PII or confidential keyword leakage detected.',
      tokensUsed: 120,
    };
  }
  if (auditorType === 'TECHNICAL' && output.includes('INVALID_SCHEMA')) {
    return {
      vote: 'FAIL',
      feedback: 'Payload contains malformed JSON structure or schema mismatch.',
      tokensUsed: 95,
    };
  }
  if (auditorType === 'COST_OPTIMIZATION' && output.length > 3000) {
    return {
      vote: 'FLAG',
      feedback: 'Payload is excessively bloated; suggested trimming context.',
      tokensUsed: 80,
    };
  }
  return {
    vote: 'PASS',
    feedback: `${auditorType} check passed successfully.`,
    tokensUsed: Math.floor(Math.random() * 150) + 50,
  };
}

// ── AdaptiveAuditHarness ───────────────────────────────────────────────────────

class AdaptiveAuditHarnessImpl implements AdaptiveAuditHarness {
  /**
   * Single auditor execution with HARD timeout enforcement.
   *
   * Key timeout guarantees:
   * 1. The simulated work delay is capped at `timeoutMs - 50` to never exceed budget.
   * 2. If the random draw would exceed the timeout budget, the promise REJECTS
   *    immediately before any token is spent — the caller never waits and gets a
   *    clean timeout result.
   * 3. The `timedOut` flag is always set correctly so the harness can aggregate
   *    and escalate appropriately.
   */
  private async simulateAuditorCheck(
    auditorType: AuditorType,
    payload: AuditTaskPayload,
    timeoutMs: number
  ): Promise<AuditorResult> {
    const startTime = Date.now();

    // Budget reserved for the harness itself — we won't let the audit eat into this.
    const RESERVE_MS = 50;
    const effectiveBudget = Math.max(timeoutMs - RESERVE_MS, 100);

    // Random draw for simulated work. Draws are wide enough to sometimes
    // exceed the effective budget, which triggers the early-bail timeout path.
    // In production this would be replaced by a real LLM call with AbortController.
    const rawDelay = Math.floor(Math.random() * (effectiveBudget * 1.5)) + 50;

    if (rawDelay >= effectiveBudget) {
      const latencyMs = Date.now() - startTime;
      return {
        auditorType,
        vote: 'FAIL',
        confidence: 1.0,
        feedback: `Auditor timed out before execution (budget=${timeoutMs}ms, simulated=${rawDelay}ms).`,
        tokensUsed: 0,   // no tokens burned — we bailed pre-execution
        latencyMs,
        timedOut: true,
      };
    }

    // Capped delay so setTimeout never fires after the deadline.
    const cappedDelay = rawDelay;

    return new Promise<AuditorResult>((resolve) => {
      let settled = false;

      // Safety net: if the timer fires late, detect it and bail out.
      // (In production this would be a real AbortController.signal on the LLM call.)
      const deadline = startTime + effectiveBudget;
      const checkDeadline = setInterval(() => {
        if (settled || Date.now() > deadline) {
          clearInterval(checkDeadline);
          if (!settled) {
            settled = true;
            const latencyMs = Date.now() - startTime;
            resolve({
              auditorType,
              vote: 'FAIL',
              confidence: 1.0,
              feedback: 'Deadline enforcement caught late-running auditor.',
              tokensUsed: 0,
              latencyMs,
              timedOut: true,
            });
          }
        }
      }, 10);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(checkDeadline);
        const latencyMs = Date.now() - startTime;
        const check = runInspection(auditorType, payload.proposedOutput);

        resolve({
          auditorType,
          vote: check.vote,
          confidence: 0.95,
          feedback: check.feedback,
          tokensUsed: check.tokensUsed,
          latencyMs,
          timedOut: false,
        });
      }, cappedDelay);
    });
  }

  public async evaluatePayload(payload: AuditTaskPayload) {
    const tierUsed = TaskTierClassifier.classify(payload);
    const rule = TIER_RULES[tierUsed];

    let totalTokensConsumed = 0;
    const startTime = Date.now();

    // Parallel across all required auditors for this tier.
    const auditPromises = rule.requiredAuditors.map((auditorType: AuditorType) =>
      this.simulateAuditorCheck(auditorType, payload, rule.timeoutMs)
    );

    const settled = await Promise.allSettled(auditPromises);
    const totalLatencyMs = Date.now() - startTime;

    const auditorResults: AuditorResult[] = [];
    const aggregatedFeedback: string[] = [];
    let hasFailures = false;
    let hasFlags = false;
    let hasHighRiskFlags = false;

    settled.forEach((result, index) => {
      let res: AuditorResult;

      if (result.status === 'fulfilled') {
        res = result.value;
      } else {
        // Promise was rejected — treat as hard failure.
        const failedAuditor = rule.requiredAuditors[index];
        res = {
          auditorType: failedAuditor,
          vote: 'FAIL',
          confidence: 1.0,
          feedback: 'Auditor promise rejected unexpectedly.',
          tokensUsed: 0,
          latencyMs: Date.now() - startTime,
          timedOut: true,
        };
      }

      auditorResults.push(res);
      totalTokensConsumed += res.tokensUsed;

      if (res.vote === 'FAIL' || res.vote === 'FLAG') {
        hasFailures = hasFailures || res.vote === 'FAIL';
        hasFlags = hasFlags || res.vote === 'FLAG';
        aggregatedFeedback.push(`[${res.auditorType}]: ${res.feedback}`);

        if (res.auditorType === 'LEGAL_POLICY') {
          hasHighRiskFlags = true;
        }
      }

      if (res.timedOut) {
        aggregatedFeedback.push(`[${res.auditorType}]: Timed out (${rule.timeoutMs}ms budget exceeded).`);
      }
    });

    // Guardrail checks.
    const exceededTokenCap = totalTokensConsumed > rule.maxTokensCap;
    const exceededLatency = totalLatencyMs > rule.timeoutMs;

    let status: HarnessDecision['status'] = 'APPROVED';

    if (hasHighRiskFlags || exceededLatency) {
      status = 'ESCALATE_H2H';
      aggregatedFeedback.push(
        exceededLatency
          ? `Overall latency ${totalLatencyMs}ms exceeded tier limit ${rule.timeoutMs}ms — escalated to H2H.`
          : 'Escalated to Human Supervisor (H2H) due to high-risk legal flags.'
      );
    } else if (hasFailures || hasFlags || exceededTokenCap) {
      status = 'BOUNCE_BACK';
      aggregatedFeedback.push('Returned to Worker Agent with corrections required.');
    }

    return {
      status,
      tierUsed,
      totalTokensConsumed,
      totalLatencyMs,
      auditorResults,
      aggregatedFeedback,
    };
  }
}

export const adaptiveAuditHarness = new AdaptiveAuditHarnessImpl();
export { AdaptiveAuditHarnessImpl as AdaptiveAuditHarness };
