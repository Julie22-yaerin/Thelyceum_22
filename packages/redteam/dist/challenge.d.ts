/**
 * The red team core engine.
 *
 * Scans claims, plans, and proposed code edits for:
 *   1. Reasoning failure modes (overconfidence, unsupported claims, confirmation bias, etc.)
 *   2. Code risks & anti-patterns (code drift, unhandled async, null pointer risks, type safety risks)
 *   3. Critical code bugs & malicious payloads (guaranteed crashes, destructive commands)
 *
 * Intelligent Dual-Tier Response:
 *   - WARN / ADVISE: Non-blocking warning flags. Agent is warned and provided with actionable advice
 *     to self-correct, but execution is NOT blocked.
 *   - BLOCK: Deterministic crash paths, malicious code, or explicit blocking flaw patterns. Execution IS blocked.
 *
 * Includes smart context compacting (Goldilocks filtering: strips hesitation fillers & duplicate words).
 */
import { CompactOptions } from "./compact.js";
export type FlawClass = "overconfidence" | "unsupported_claim" | "confirmation_bias" | "false_dichotomy" | "missing_tradeoff" | "strawman" | "anecdote_as_evidence" | "slippery_slope" | "unchecked_assumption" | "security_bypass" | "context_drift" | "ping_pong_loop" | "code_drift" | "unhandled_async_risk" | "null_pointer_risk" | "type_safety_risk" | "resource_leak_risk" | "guaranteed_crash" | "malicious_payload" | "infinite_loop_risk" | "hallucinated_package_risk";
export declare const FLAW_CLASSES: readonly FlawClass[];
export interface RedFlag {
    flaw: FlawClass;
    severity: "warning" | "blocking";
    /** What was observed, quoted so the model can judge it itself. */
    evidence: string;
    /** Plain-language explanation of why this is a reasoning flaw or code risk. */
    explanation: string;
    /** The devil's-advocate question that answers this flaw. */
    counter: string;
    /** Actionable recommendation for the agent (especially for warnings). */
    advice?: string;
}
export interface ChallengeVerdict {
    /** high = no flags. medium = warnings present (not blocked). low = blocked. */
    confidence: "high" | "medium" | "low";
    /** True when a blocking flaw matched, or total flags exceeded threshold. */
    blocked: boolean;
    /** Action directive for agent: 'allow' (clean), 'warn' (adjust direction), 'block' (stop execution) */
    action: "allow" | "warn" | "block";
    /** List of warning messages/advice for the agent to refine code/reasoning without blocking. */
    warnings: string[];
    summary: string;
}
export interface ChallengeResult {
    text: string;
    compactedText?: string;
    flags: RedFlag[];
    /** The counter-arguments / steelman questions. Always non-empty. */
    counter: string[];
    verdict: ChallengeVerdict;
}
export interface ChallengeOptions {
    /** Flaw classes that block. Defaults to the blocking set. */
    blockOn?: ReadonlySet<FlawClass>;
    /** Automatically compact input text (clean hesitation words & duplicate words). Default: true */
    autoCompact?: boolean;
    compactOpts?: CompactOptions;
}
/** A flagged argument becomes blocking when it hits this many flags, even if no single flaw is blocking. */
export declare const MAX_UNBLOCKED_FLAGS = 3;
export declare function challenge(text: string, opts?: ChallengeOptions): ChallengeResult;
/**
 * Quick devil's advocate: return counters and verdict.
 */
export declare function rebut(text: string, opts?: ChallengeOptions): ChallengeResult;
/** Public list of flaw rules, for the model to see what's watched. */
export declare function listFlawRules(): {
    flaw: FlawClass;
    severity: "warning" | "blocking";
    blocking: boolean;
    explanation: string;
    counter: string;
}[];
//# sourceMappingURL=challenge.d.ts.map