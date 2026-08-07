/**
 * Thrift (Saver) — Runaway Loop Interceptor.
 *
 * Manages token-expensive operations and detects runaway tool loops.
 * Strictly enforces MAX_ALLOWED_REPETITIONS = 2. If an action or intent
 * repeats more than 2 times, thrift intercepts and trips the loop, cutting off
 * token waste and logging exact tokens & dollars saved.
 */
export const MAX_ALLOWED_REPETITIONS = 2;
class LoopTracker {
    history = new Map();
    /** Normalize intent/action string into a hash signature */
    getSignature(actionKey) {
        return actionKey.trim().toLowerCase().replace(/\s+/g, " ");
    }
    /** Record an action and check if it exceeds the max 2 repetitions threshold */
    trackAndCheck(actionKey, payloadLength = 500) {
        const signature = this.getSignature(actionKey);
        const now = Date.now();
        const entry = this.history.get(signature) ?? { count: 0, firstSeen: now, lastSeen: now };
        entry.count += 1;
        entry.lastSeen = now;
        this.history.set(signature, entry);
        if (entry.count > MAX_ALLOWED_REPETITIONS) {
            // Calculate token burn saved if loop had continued (estimate ~250k tokens per runaway loop)
            const inputTokens = Math.ceil(payloadLength / 4);
            const tokensSaved = 250000 + inputTokens * (entry.count - 2) * 5;
            const dollarsSaved = parseFloat((tokensSaved * 0.000015).toFixed(4));
            return {
                tripped: true,
                action: "intercept_loop",
                repetitionCount: entry.count,
                maxAllowed: MAX_ALLOWED_REPETITIONS,
                tokensSaved,
                dollarsSaved,
                reason: `Runaway loop intercepted: action repeated ${entry.count} times (max allowed: ${MAX_ALLOWED_REPETITIONS}). Stopped execution to protect token budget.`,
                signature,
            };
        }
        return {
            tripped: false,
            action: "allow",
            repetitionCount: entry.count,
            maxAllowed: MAX_ALLOWED_REPETITIONS,
            tokensSaved: 0,
            dollarsSaved: 0,
            signature,
        };
    }
    reset() {
        this.history.clear();
    }
}
export const globalLoopTracker = new LoopTracker();
//# sourceMappingURL=loop.js.map