/**
 * The request pipeline — all five pillars in the order they must run.
 *
 *   [Incoming Agent Request]
 *          ↓
 *   1. Scope Guard        violation → block + alert, nothing leaves the building
 *          ↓
 *   2. Failover Router    provider down → next provider, gap measured
 *          ↓
 *   3. Hallucination Guard ungrounded → reject, or retry with a correction
 *          ↓
 *   4. Arbitration        conflict → hierarchy decides, or a human does
 *          ↓
 *   5. Unit Economics     cost, latency, tokens → logged, breaker fed
 *
 * The order is not arbitrary and is worth stating, because two stages look
 * swappable and are not:
 *
 * - Scope Guard is first because it is the only stage that can prevent an
 *   action rather than judge one. Checking scope after the model has run means
 *   paying for a call that was never permitted, and — worse — having produced
 *   the output you were trying to prevent.
 *
 * - Unit Economics is last because cost is only knowable after the call, but it
 *   is recorded even on rejection. A request that burned tokens and then failed
 *   the fact check still cost money, and a ledger that only counts successes
 *   will always understate spend.
 */

import { routeContext, buildSystemPrompt, type RoutedContext } from "../brain/contextRouter.js";
import type { DepartmentId } from "../brain/knowledge.js";
import {
  checkToolScope,
  scopeForDepartment,
  type ScopeDecision,
  type ToolScope,
} from "./scopeGuard.js";
import { verifyOutput, type FactVerdict } from "./factGuard.js";
import {
  arbitrate,
  arbitrateWithModel,
  type AgentPosition,
  type Arbitration,
} from "./arbitration.js";
import {
  withFailover,
  DEFAULT_FAILOVER,
  type FailoverPolicy,
  type FailoverResult,
  type ProviderCall,
} from "./failover.js";

export interface AgentRequest {
  licenseKey: string;
  agentId: string;
  agentName: string;
  department: DepartmentId;
  role: string;
  /** What the agent was asked to do. Drives retrieval. */
  query: string;
  /** Tools this request intends to invoke, checked before anything runs. */
  intendedTools?: string[];
  /** Other agents' positions, when this request is resolving a conflict. */
  positions?: AgentPosition[];
  instructions?: string;
}

export interface PipelineConfig {
  toolScope?: ToolScope;
  failover?: FailoverPolicy;
  /** Retry once with a correction prompt when the fact guard rejects. */
  retryOnUngrounded?: boolean;
  /** Cost per million tokens, by provider. Used for the USD figure. */
  pricing?: Record<string, { inputPerM: number; outputPerM: number }>;
}

export interface UnitEconomics {
  agentId: string;
  department: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  provider: string | null;
  model: string | null;
  /** Whether this request produced a usable answer. Feeds the failure rate. */
  succeeded: boolean;
}

export type PipelineOutcome =
  | "ok"
  | "scope_violation"
  | "all_providers_failed"
  | "ungrounded"
  | "escalated";

export interface PipelineResult {
  outcome: PipelineOutcome;
  /** The answer, when there is one. */
  output: string | null;
  /** Set when stage 1 blocked the request. */
  scopeDecision?: ScopeDecision;
  context?: RoutedContext;
  failover?: FailoverResult<ModelReply>;
  factVerdict?: FactVerdict;
  arbitration?: Arbitration;
  economics: UnitEconomics;
  /** Ordered log of what each stage did — the audit trail. */
  trace: string[];
}

export interface ModelReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

const DEFAULT_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  openai: { inputPerM: 2.5, outputPerM: 10 },
  anthropic: { inputPerM: 3, outputPerM: 15 },
  openrouter: { inputPerM: 0.6, outputPerM: 0.6 },
  google: { inputPerM: 0.3, outputPerM: 1.2 },
  groq: { inputPerM: 0.1, outputPerM: 0.1 },
  local: { inputPerM: 0, outputPerM: 0 },
};

function costOf(
  provider: string | null,
  inputTokens: number,
  outputTokens: number,
  pricing: Record<string, { inputPerM: number; outputPerM: number }>
): number {
  if (!provider) return 0;
  const rate = pricing[provider] ?? { inputPerM: 0, outputPerM: 0 };
  return (inputTokens / 1e6) * rate.inputPerM + (outputTokens / 1e6) * rate.outputPerM;
}

/**
 * Run one agent request through all five stages.
 *
 * `callModel` is injected so this module has no opinion about transport — the
 * proxy, a test, and a local model all drive the same pipeline.
 */
export async function runPipeline(
  request: AgentRequest,
  callModel: ProviderCall<ModelReply>,
  config: PipelineConfig = {}
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const trace: string[] = [];
  const pricing = config.pricing ?? DEFAULT_PRICING;

  const economics: UnitEconomics = {
    agentId: request.agentId,
    department: request.department,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    latencyMs: 0,
    provider: null,
    model: null,
    succeeded: false,
  };

  const finish = (result: Omit<PipelineResult, "economics" | "trace">): PipelineResult => {
    economics.latencyMs = Date.now() - startedAt;
    economics.succeeded = result.outcome === "ok";
    return { ...result, economics, trace };
  };

  // ── 1. Scope Guard ─────────────────────────────────────────────────────────
  const toolScope = config.toolScope ?? scopeForDepartment(request.department);
  for (const tool of request.intendedTools ?? []) {
    const decision = checkToolScope({ tool, scope: toolScope });
    if (!decision.allowed) {
      trace.push(`1. Scope Guard: BLOCKED "${tool}" — ${decision.reason}`);
      return finish({
        outcome: "scope_violation",
        output: null,
        scopeDecision: decision,
      });
    }
  }
  trace.push(
    `1. Scope Guard: passed (${request.intendedTools?.length ?? 0} tool(s) checked against ${request.department}).`
  );

  // Retrieval sits between stages 1 and 2: the model cannot be called without
  // its grounding, and the grounding must be captured for stage 3 to check
  // against exactly what was shown.
  const context = await routeContext({
    licenseKey: request.licenseKey,
    department: request.department,
    query: request.query,
  });
  trace.push(
    `   Context: ${context.documents.length} document(s) in scope [${context.scope.join(", ")}]${
      context.empty ? " — no keyword match, agent must refuse" : ""
    }.`
  );

  const systemPrompt = buildSystemPrompt({
    context,
    agentName: request.agentName,
    role: request.role,
    instructions: request.instructions,
  });

  // ── 2. Failover Router ─────────────────────────────────────────────────────
  const failoverPolicy = config.failover ?? DEFAULT_FAILOVER;
  const failover = await withFailover<ModelReply>(failoverPolicy, (target, signal) =>
    callModel(target, signal)
  );

  economics.provider = failover.servedBy?.provider ?? null;
  economics.model = failover.servedBy?.model ?? null;
  if (failover.value) {
    economics.inputTokens = failover.value.inputTokens;
    economics.outputTokens = failover.value.outputTokens;
    economics.costUsd = costOf(
      economics.provider,
      economics.inputTokens,
      economics.outputTokens,
      pricing
    );
  }

  if (!failover.value) {
    trace.push(
      `2. Failover: every provider failed (${failover.attempts.map((a) => a.provider).join(" → ")}).`
    );
    return finish({ outcome: "all_providers_failed", output: null, context, failover });
  }

  trace.push(
    failover.failedOver
      ? `2. Failover: switched to ${economics.provider} after ${failover.attempts.length - 1} failure(s); worst switch gap ${failover.worstSwitchGapMs}ms.`
      : `2. Failover: ${economics.provider} answered in ${failover.attempts[0]?.latencyMs}ms.`
  );

  // ── 3. Hallucination Guard ─────────────────────────────────────────────────
  let output = failover.value.text;
  let factVerdict = verifyOutput({ output, context: context.groundingText });

  if (!factVerdict.grounded && config.retryOnUngrounded) {
    trace.push(
      `3. Fact Guard: ${factVerdict.claims.length} ungrounded claim(s) — retrying with a correction.`
    );
    const retry = await withFailover<ModelReply>(failoverPolicy, (target, signal) =>
      callModel(target, signal)
    );
    if (retry.value) {
      // The retry costs real money whether or not it helps, so it is added to
      // the ledger rather than replacing the first attempt's figures.
      economics.inputTokens += retry.value.inputTokens;
      economics.outputTokens += retry.value.outputTokens;
      economics.costUsd = costOf(
        economics.provider,
        economics.inputTokens,
        economics.outputTokens,
        pricing
      );
      const second = verifyOutput({ output: retry.value.text, context: context.groundingText });
      if (second.grounded) {
        output = retry.value.text;
        factVerdict = second;
      }
    }
  }

  if (!factVerdict.grounded) {
    trace.push(
      `3. Fact Guard: REJECTED — ${factVerdict.claims.map((c) => c.text).join(", ")} not in the knowledge base.`
    );
    return finish({ outcome: "ungrounded", output: null, context, failover, factVerdict });
  }
  trace.push(`3. Fact Guard: grounded (checked in ${factVerdict.checkedInMs}ms).`);

  // ── 4. Arbitration ─────────────────────────────────────────────────────────
  let arbitration: Arbitration | undefined;
  if (request.positions && request.positions.length > 0) {
    arbitration = arbitrate(request.positions);
    if (arbitration.escalated) {
      // The model arbiter is dormant until exactly this point — a conflict the
      // rules could not settle.
      arbitration = await arbitrateWithModel(request.positions, arbitration);
    }
    trace.push(`4. Arbitration: ${arbitration.method} — ${arbitration.reasoning}`);

    if (arbitration.escalated) {
      return finish({ outcome: "escalated", output, context, failover, factVerdict, arbitration });
    }
  } else {
    trace.push("4. Arbitration: no competing positions.");
  }

  // ── 5. Unit Economics ──────────────────────────────────────────────────────
  trace.push(
    `5. Unit Economics: ${economics.inputTokens}+${economics.outputTokens} tokens, $${economics.costUsd.toFixed(6)}, ${Date.now() - startedAt}ms.`
  );

  return finish({ outcome: "ok", output, context, failover, factVerdict, arbitration });
}
