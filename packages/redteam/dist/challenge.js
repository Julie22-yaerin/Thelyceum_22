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
import { compactContext } from "./compact.js";
import { CODE_RULES, scanCodeFlaws } from "./code_scanner.js";
export const FLAW_CLASSES = [
    "overconfidence",
    "unsupported_claim",
    "confirmation_bias",
    "false_dichotomy",
    "missing_tradeoff",
    "strawman",
    "anecdote_as_evidence",
    "slippery_slope",
    "unchecked_assumption",
    "security_bypass",
    "context_drift",
    "ping_pong_loop",
    "code_drift",
    "unhandled_async_risk",
    "null_pointer_risk",
    "type_safety_risk",
    "resource_leak_risk",
    "guaranteed_crash",
    "malicious_payload",
    "infinite_loop_risk",
    "hallucinated_package_risk",
];
/** A flagged argument becomes blocking when it hits this many flags, even if no single flaw is blocking. */
export const MAX_UNBLOCKED_FLAGS = 3;
const GENERIC_COUNTERS = [
    "What is the strongest version of the opposing position? State it fairly before you answer it.",
    "What evidence would change your conclusion? Name it explicitly.",
    "Under what conditions is your claim false? List at least one concrete failure mode.",
    "What would a smart, well-informed person who disagrees say, and why?",
];
const REASONING_RULES = [
    {
        flaw: "overconfidence",
        severity: "warning",
        explanation: "Absolute certainty with no room for error. Confident claims are where AI reasoning is most often wrong.",
        counter: "Rewrite the claim with the certainty removed ('probably', 'may'). Does it still hold? State the confidence you can actually defend.",
        pattern: /\b(?:obviously|clearly|certainly|definitely|undoubtedly|surely|guaranteed|foolproof|trivially|no doubt|without a doubt|rõ ràng|chắc chắn|hiển nhiên|đương nhiên|không thể sai)\b/i,
    },
    {
        flaw: "unsupported_claim",
        severity: "blocking",
        explanation: "The claim leans on an unnamed authority — research, data, experts — without a citation. An authority with no source is a placeholder, not evidence.",
        counter: "Attach the source: which study, which dataset, which experts? If it cannot be cited, mark the claim as an opinion and say what would test it.",
        pattern: /\b(?:research shows|studies show|studies have shown|experts agree|it is well known|as everyone knows|it is widely believed|data shows|statistics show|it has been proven|according to research|nghiên cứu cho thấy|số liệu cho thấy|chuyên gia đồng ý|ai cũng biết|đã được chứng minh)\b/i,
    },
    {
        flaw: "confirmation_bias",
        severity: "blocking",
        explanation: "Only the supporting side is counted. A plan with no downside, no risks, and no alternative is one-sided — that is the shape of a confident mistake.",
        counter: "List three reasons the opposite might be true, then answer each. If the conclusion survives that test, proceed; if not, revise it.",
        pattern: /\b(?:no downside|no risks|no risk|only upside|perfect solution|nothing could go wrong|can'?t lose|cannot lose|clearly the right choice|no alternative|obviously correct|không có rủi ro|chỉ có lợi|phương án hoàn hảo|không thể thất bại)\b/i,
    },
    {
        flaw: "false_dichotomy",
        severity: "warning",
        explanation: "The reasoning forces a choice between one or two options as if nothing else existed. Reality usually has a third path: do nothing, do less, do it later, or combine.",
        counter: "Enumerate at least one option outside the binary — including doing nothing. If the binary is real, say why the third option fails.",
        pattern: /\b(?:the only (?:option|choice|way|solution)|only two (?:options|choices|possibilities)|false dichotomy|black and white|chỉ có hai lựa chọn|lựa chọn duy nhất)\b/i,
    },
    {
        flaw: "missing_tradeoff",
        severity: "warning",
        explanation: "A recommendation is made without pricing its downside. Every decision carries a trade-off; one that is not stated will surface later as a surprise.",
        counter: "Price the downside: what breaks, what it costs, how you roll back. A decision without its trade-offs is not yet a decision.",
        evaluate: (text) => {
            const decision = text.match(/\b(?:we should|i recommend|i suggest|i propose|best to|let'?s|go with|we'?ll use|we will use|the plan is|nên dùng|nên làm|nên chọn|đề xuất|khuyến nghị|kế hoạch là|tốt nhất)\b/i);
            if (!decision)
                return null;
            const tradeoff = /\b(?:cost|costs|risk|risks|downside|tradeoff|trade-?off|drawback|maintenance|rollback|failure|budget|chi phí|rủi ro|nhược điểm|đánh đổi|phức tạp|tốn kém)\b/i;
            if (tradeoff.test(text))
                return null;
            return decision[0];
        },
    },
    {
        flaw: "strawman",
        severity: "warning",
        explanation: "The opposing view is quoted only to be dismissed. Restating the weakest version of the other side proves nothing about the real position.",
        counter: "Restate the other side in its strongest form, the way its smartest defender would. Rebut that version, not the caricature.",
        pattern: /\b(?:critics|opponents|skeptics|detractors|some might argue)\b[^.!?]{0,90}\b(?:claim|argue|think|believe|say)\b/i,
    },
    {
        flaw: "anecdote_as_evidence",
        severity: "warning",
        explanation: "Personal experience is presented as if it settled the question. One data point is a prior, not a proof.",
        counter: "How many cases, and how were they sampled? What would the counter-example look like? Generalize, or label it as experience, not evidence.",
        pattern: /\b(?:in my experience|from my experience|i'?ve seen|i have seen|my team found|i once|everyone knows|in practice we found|theo kinh nghiệm của tôi|tôi từng thấy|ai cũng biết)\b/i,
    },
    {
        flaw: "slippery_slope",
        severity: "warning",
        explanation: "'If we allow X, then Y, then everyone…' — a chain asserted without a mechanism. Each step needs evidence, not just a story.",
        counter: "Show the mechanism at each step of the chain. Where does it break, and what guardrail stops the descent before the claimed end?",
        pattern: /\bslippery slope\b|\bif we (?:allow|let|accept)\b[^.!?]{0,120}\b(?:then|next)\b/i,
    },
    {
        flaw: "unchecked_assumption",
        severity: "warning",
        explanation: "The reasoning rests on an explicit assumption. It may be true — but nothing here checks whether it is, or what breaks if it is not.",
        counter: "Verify the assumption before building on it. What is the cheapest way to test it, and what is the fallback if it fails?",
        pattern: /\b(?:assuming|assume that|presumably|safe to assume|giả sử|giả định)\b/i,
    },
    {
        flaw: "security_bypass",
        severity: "blocking",
        explanation: "Reasoning attempts to bypass security policies, disable authentication, or skip validation under a temporary or testing pretext.",
        counter: "Security policies must be maintained across all environments. Use mock authentication or explicit test configurations instead of disabling safety controls.",
        pattern: /\b(?:disable\s+(?:auth|authentication|validation|security|ssl|cors)|bypass\s+(?:auth|validation|check|rule|policy|security)|ignore\s+(?:security|policy|auth)|for\s+testing\s+purposes?\s+only|bỏ\s+qua\s+(?:xác\s+thực|kiểm\s+tra|bảo\s+mật)|tạm\s+thời\s+tắt)\b/i,
    },
    {
        flaw: "context_drift",
        severity: "warning",
        explanation: "Agent context drift or repetitive self-referential loop detected. The reasoning is repeating prior statements without advancing task execution.",
        counter: "Has the agent diverged from the user's primary goal? Require resetting context focus to primary objectives.",
        pattern: /\b(?:as\s+i\s+(?:mentioned|said)\s+earlier|let\s+me\s+re-read|re-reading\s+the\s+same|gửi\s+lại\s+yêu\s+cầu|nói\s+lại\s+lần\s+nữa)\b/i,
    },
    {
        flaw: "ping_pong_loop",
        severity: "blocking",
        explanation: "Multi-agent ping-pong delegation loop detected. Subagents are delegating tasks endlessly back and forth.",
        counter: "Subagents are delegating back and forth without resolving the task. Require explicit handoff termination.",
        pattern: /\b(?:waiting\s+for\s+subagent|delegat(?:ed|ing)\s+to\s+subagent|subagent\s+returned|ping[\s-]?pong)\b[^.\n]{0,60}\b(?:again|repeatedly|loop)\b/i,
    },
];
export function challenge(text, opts = {}) {
    const autoCompact = opts.autoCompact ?? true;
    let targetText = text ? text.replace(/\r\n/g, "\n") : "";
    let compactedText;
    if (autoCompact && text && text.trim().length > 0) {
        const compactRes = compactContext(text, opts.compactOpts);
        targetText = compactRes.compactedText;
        if (compactRes.removedTokensCount > 0) {
            compactedText = compactRes.compactedText;
        }
    }
    // Determine blocking set
    const defaultBlockingSet = new Set([
        ...REASONING_RULES.filter((r) => r.severity === "blocking").map((r) => r.flaw),
        ...CODE_RULES.filter((r) => r.severity === "blocking").map((r) => r.flaw),
    ]);
    const blockOn = opts.blockOn ?? defaultBlockingSet;
    const flags = [];
    // 1. Scan Reasoning Flaws
    for (const rule of REASONING_RULES) {
        let evidence = null;
        if (rule.evaluate) {
            evidence = rule.evaluate(targetText);
        }
        else if (rule.pattern) {
            const m = targetText.match(rule.pattern);
            if (m)
                evidence = m[0];
        }
        if (evidence) {
            flags.push({
                flaw: rule.flaw,
                severity: rule.severity,
                evidence: evidence.slice(0, 200),
                explanation: rule.explanation,
                counter: rule.counter,
            });
        }
    }
    // 2. Scan Code Flaws & Anti-Patterns
    const codeFlags = scanCodeFlaws(targetText);
    flags.push(...codeFlags);
    // Determine Blocking vs Warning
    const blockedByFlaw = flags.some((f) => blockOn.has(f.flaw) || f.severity === "blocking");
    const blockedByVolume = flags.length >= MAX_UNBLOCKED_FLAGS;
    const blocked = blockedByFlaw || blockedByVolume;
    const action = blocked
        ? "block"
        : flags.length > 0
            ? "warn"
            : "allow";
    const warnings = flags
        .filter((f) => f.severity === "warning" || !blocked)
        .map((f) => `[${f.flaw.toUpperCase()}] ${f.explanation}${f.advice ? ` -> Advice: ${f.advice}` : ""}`);
    const counter = [...GENERIC_COUNTERS];
    for (const f of flags) {
        if (!counter.includes(f.counter))
            counter.push(f.counter);
    }
    const confidence = flags.length === 0 ? "high" : flags.length <= 2 && !blocked ? "medium" : "low";
    let summary;
    if (flags.length === 0) {
        summary = "No red flags found. Reasoning and code appear sound; proceed with confidence.";
    }
    else if (blocked) {
        summary = `BLOCKED: ${flags.length} flag(s) detected — ${flags.map((f) => f.flaw).join(", ")}. Critical failure path or deterministic risk detected; resolve flaws before proceeding.`;
    }
    else {
        summary = `WARNING: ${flags.length} warning flag(s) detected — ${flags.map((f) => f.flaw).join(", ")}. Code/reasoning may be drifting off-track. Review advice to refine approach without blocking.`;
    }
    return {
        text,
        compactedText,
        flags,
        counter,
        verdict: {
            confidence,
            blocked,
            action,
            warnings,
            summary,
        },
    };
}
/**
 * Quick devil's advocate: return counters and verdict.
 */
export function rebut(text, opts = {}) {
    return challenge(text, opts);
}
/** Public list of flaw rules, for the model to see what's watched. */
export function listFlawRules() {
    const reasoningList = REASONING_RULES.map((r) => ({
        flaw: r.flaw,
        severity: r.severity,
        blocking: r.severity === "blocking",
        explanation: r.explanation,
        counter: r.counter,
    }));
    const codeList = CODE_RULES.map((r) => ({
        flaw: r.flaw,
        severity: r.severity,
        blocking: r.severity === "blocking",
        explanation: r.explanation,
        counter: r.counter,
    }));
    return [...reasoningList, ...codeList];
}
//# sourceMappingURL=challenge.js.map