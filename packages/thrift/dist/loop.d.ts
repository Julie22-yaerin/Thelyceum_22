/**
 * Thrift — Runaway Loop Interceptor.
 *
 * Manages token-expensive operations and detects runaway tool loops.
 * Strictly enforces MAX_ALLOWED_REPETITIONS = 2. If an action or intent
 * repeats more than 2 times, thrift intercepts and trips the loop, cutting off
 * token waste and logging exact tokens & dollars saved.
 */
export declare const MAX_ALLOWED_REPETITIONS = 2;
export interface LoopCheckResult {
    tripped: boolean;
    action: "allow" | "intercept_loop";
    repetitionCount: number;
    maxAllowed: number;
    tokensSaved: number;
    dollarsSaved: number;
    reason?: string;
    signature: string;
}
declare class LoopTracker {
    private history;
    /** Normalize intent/action string into a hash signature */
    private getSignature;
    /** Record an action and check if it exceeds the max 2 repetitions threshold */
    trackAndCheck(actionKey: string, payloadLength?: number): LoopCheckResult;
    reset(): void;
}
export declare const globalLoopTracker: LoopTracker;
export {};
