/**
 * The red team.
 *
 * One job: break the AI's reasoning before it ships. Where the brake stops
 * a dangerous action, the red team attacks a one-sided argument. It scans a
 * claim, plan, or piece of reasoning for the failure modes that make AI
 * answers look confident and turn out wrong — overconfidence, unsupported
 * claims, confirmation bias, false dichotomies, missing trade-offs, straw
 * men, anecdote-as-evidence, slippery slopes, and unchecked assumptions —
 * then it steelmans the other side so the reasoning is tested instead of
 * asserted.
 *
 * Pure module. No I/O, no global state, no opinion about storage. The caller
 * decides what to do with the verdict: exit code, hook block, audit line,
 * MCP result.
 */

export type FlawClass =
  | "overconfidence"
  | "unsupported_claim"
  | "confirmation_bias"
  | "false_dichotomy"
  | "missing_tradeoff"
  | "strawman"
  | "anecdote_as_evidence"
  | "slippery_slope"
  | "unchecked_assumption";

export const FLAW_CLASSES: readonly FlawClass[] = [
  "overconfidence",
  "unsupported_claim",
  "confirmation_bias",
  "false_dichotomy",
  "missing_tradeoff",
  "strawman",
  "anecdote_as_evidence",
  "slippery_slope",
  "unchecked_assumption",
];

export interface RedFlag {
  flaw: FlawClass;
  /** What was observed, quoted so the model can judge it itself. */
  evidence: string;
  /** Plain-language explanation of why this is a reasoning flaw. */
  explanation: string;
  /** The devil's-advocate question that answers this flaw. */
  counter: string;
}

export interface ChallengeVerdict {
  /** high = no flags. medium = flagged but not blocked. low = blocked. */
  confidence: "high" | "medium" | "low";
  /** True when a blocking flaw matched, or flags exceeded the threshold. */
  blocked: boolean;
  summary: string;
}

export interface ChallengeResult {
  text: string;
  flags: RedFlag[];
  /** The counter-arguments / steelman questions. Always non-empty. */
  counter: string[];
  verdict: ChallengeVerdict;
}

export interface ChallengeOptions {
  /** Flaw classes that block. Defaults to the blocking set. */
  blockOn?: ReadonlySet<FlawClass>;
}

/** A flagged argument becomes blocking when it hits this many flags, even if no single flaw is blocking. */
export const MAX_UNBLOCKED_FLAGS = 3;

interface FlawRule {
  flaw: FlawClass;
  blocking: boolean;
  explanation: string;
  counter: string;
  /** Line-level pattern. Some rules use `evaluate` instead (structural). */
  pattern?: RegExp;
  /** Structural check. Returns the evidence string when the flaw applies. */
  evaluate?: (text: string) => string | null;
}

const GENERIC_COUNTERS: string[] = [
  "What is the strongest version of the opposing position? State it fairly before you answer it.",
  "What evidence would change your conclusion? Name it explicitly.",
  "Under what conditions is your claim false? List at least one concrete failure mode.",
  "What would a smart, well-informed person who disagrees say, and why?",
];

const RULES: FlawRule[] = [
  {
    flaw: "overconfidence",
    blocking: false,
    explanation: "Absolute certainty with no room for error. Confident claims are where AI reasoning is most often wrong.",
    counter: "Rewrite the claim with the certainty removed ('probably', 'may'). Does it still hold? State the confidence you can actually defend.",
    pattern: /\b(?:obviously|clearly|certainly|definitely|undoubtedly|surely|guaranteed|foolproof|trivially|no doubt|without a doubt|rõ ràng|chắc chắn|hiển nhiên|đương nhiên|không thể sai)\b/i,
  },
  {
    flaw: "unsupported_claim",
    blocking: true,
    explanation: "The claim leans on an unnamed authority — research, data, experts — without a citation. An authority with no source is a placeholder, not evidence.",
    counter: "Attach the source: which study, which dataset, which experts? If it cannot be cited, mark the claim as an opinion and say what would test it.",
    pattern: /\b(?:research shows|studies show|studies have shown|experts agree|it is well known|as everyone knows|it is widely believed|data shows|statistics show|it has been proven|according to research|nghiên cứu cho thấy|số liệu cho thấy|chuyên gia đồng ý|ai cũng biết|đã được chứng minh)\b/i,
  },
  {
    flaw: "confirmation_bias",
    blocking: true,
    explanation: "Only the supporting side is counted. A plan with no downside, no risks, and no alternative is one-sided — that is the shape of a confident mistake.",
    counter: "List three reasons the opposite might be true, then answer each. If the conclusion survives that test, proceed; if not, revise it.",
    pattern: /\b(?:no downside|no risks|no risk|only upside|perfect solution|nothing could go wrong|can'?t lose|cannot lose|clearly the right choice|no alternative|obviously correct|không có rủi ro|chỉ có lợi|phương án hoàn hảo|không thể thất bại)\b/i,
  },
  {
    flaw: "false_dichotomy",
    blocking: false,
    explanation: "The reasoning forces a choice between one or two options as if nothing else existed. Reality usually has a third path: do nothing, do less, do it later, or combine.",
    counter: "Enumerate at least one option outside the binary — including doing nothing. If the binary is real, say why the third option fails.",
    pattern: /\b(?:the only (?:option|choice|way|solution)|only two (?:options|choices|possibilities)|false dichotomy|black and white|chỉ có hai lựa chọn|lựa chọn duy nhất)\b/i,
  },
  {
    flaw: "missing_tradeoff",
    blocking: false,
    explanation: "A recommendation is made without pricing its downside. Every decision carries a trade-off; one that is not stated will surface later as a surprise.",
    counter: "Price the downside: what breaks, what it costs, how you roll back. A decision without its trade-offs is not yet a decision.",
    evaluate: (text) => {
      const decision = text.match(
        /\b(?:we should|i recommend|i suggest|i propose|best to|let'?s|go with|we'?ll use|we will use|the plan is|nên dùng|nên làm|nên chọn|đề xuất|khuyến nghị|kế hoạch là|tốt nhất)\b/i
      );
      if (!decision) return null;
      const tradeoff = /\b(?:cost|costs|risk|risks|downside|tradeoff|trade-?off|drawback|maintenance|rollback|failure|budget|chi phí|rủi ro|nhược điểm|đánh đổi|phức tạp|tốn kém)\b/i;
      if (tradeoff.test(text)) return null;
      return decision[0];
    },
  },
  {
    flaw: "strawman",
    blocking: false,
    explanation: "The opposing view is quoted only to be dismissed. Restating the weakest version of the other side proves nothing about the real position.",
    counter: "Restate the other side in its strongest form, the way its smartest defender would. Rebut that version, not the caricature.",
    pattern: /\b(?:critics|opponents|skeptics|detractors|some might argue)\b[^.!?]{0,90}\b(?:claim|argue|think|believe|say)\b/i,
  },
  {
    flaw: "anecdote_as_evidence",
    blocking: false,
    explanation: "Personal experience is presented as if it settled the question. One data point is a prior, not a proof.",
    counter: "How many cases, and how were they sampled? What would the counter-example look like? Generalize, or label it as experience, not evidence.",
    pattern: /\b(?:in my experience|from my experience|i'?ve seen|i have seen|my team found|i once|everyone knows|in practice we found|theo kinh nghiệm của tôi|tôi từng thấy|ai cũng biết)\b/i,
  },
  {
    flaw: "slippery_slope",
    blocking: false,
    explanation: "'If we allow X, then Y, then everyone…' — a chain asserted without a mechanism. Each step needs evidence, not just a story.",
    counter: "Show the mechanism at each step of the chain. Where does it break, and what guardrail stops the descent before the claimed end?",
    pattern: /\bslippery slope\b|\bif we (?:allow|let|accept)\b[^.!?]{0,120}\b(?:then|next)\b/i,
  },
  {
    flaw: "unchecked_assumption",
    blocking: false,
    explanation: "The reasoning rests on an explicit assumption. It may be true — but nothing here checks whether it is, or what breaks if it is not.",
    counter: "Verify the assumption before building on it. What is the cheapest way to test it, and what is the fallback if it fails?",
    pattern: /\b(?:assuming|assume that|presumably|safe to assume|giả sử|giả định)\b/i,
  },
];

export function challenge(text: string, opts: ChallengeOptions = {}): ChallengeResult {
  const blockOn = opts.blockOn ?? new Set(RULES.filter((r) => r.blocking).map((r) => r.flaw));

  const flags: RedFlag[] = [];
  for (const rule of RULES) {
    let evidence: string | null = null;
    if (rule.evaluate) {
      evidence = rule.evaluate(text);
    } else if (rule.pattern) {
      const m = text.match(rule.pattern);
      if (m) evidence = m[0];
    }
    if (evidence) {
      flags.push({
        flaw: rule.flaw,
        evidence: evidence.slice(0, 200),
        explanation: rule.explanation,
        counter: rule.counter,
      });
    }
  }

  const blockedByFlaw = flags.some((f) => blockOn.has(f.flaw));
  const blockedByVolume = flags.length >= MAX_UNBLOCKED_FLAGS;
  const blocked = blockedByFlaw || blockedByVolume;

  const counter = [...GENERIC_COUNTERS];
  for (const f of flags) {
    if (!counter.includes(f.counter)) counter.push(f.counter);
  }

  const confidence: ChallengeVerdict["confidence"] =
    flags.length === 0 ? "high" : flags.length <= 2 && !blocked ? "medium" : "low";

  let summary: string;
  if (flags.length === 0) {
    summary = "No red flags found. The reasoning appears two-sided; proceed with confidence.";
  } else if (blocked) {
    summary = `Blocked: ${flags.length} red flag(s) — ${flags.map((f) => f.flaw).join(", ")}. The reasoning is one-sided; resolve the counters before presenting this as settled.`;
  } else {
    summary = `Challenged: ${flags.length} red flag(s) — ${flags.map((f) => f.flaw).join(", ")}. Review the counters before presenting this as settled.`;
  }

  return { text, flags, counter, verdict: { confidence, blocked, summary } };
}

/**
 * Quick devil's advocate: return only the counters and verdict, without the
 * full flag audit. Cheap enough to call on every important answer.
 */
export function rebut(text: string, opts: ChallengeOptions = {}): ChallengeResult {
  return challenge(text, opts);
}

/** Public list of flaw rules, for the model to see what's watched. */
export function listFlawRules(): { flaw: FlawClass; blocking: boolean; explanation: string; counter: string }[] {
  return RULES.map((r) => ({ flaw: r.flaw, blocking: r.blocking, explanation: r.explanation, counter: r.counter }));
}
