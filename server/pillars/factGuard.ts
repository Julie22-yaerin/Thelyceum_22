/**
 * Pillar 2 — Reality check / hallucination guard.
 *
 * Checks an agent's output against the exact context it was grounded on. Not a
 * re-query: the same text the model was shown, so a document changing between
 * generation and verification cannot turn a correct answer into a violation.
 *
 * The hard design constraint is the false-positive rate. A guard that flags
 * ordinary prose gets switched off within a week, and then it protects nothing.
 * So it checks the claims that actually cost money or trust — currency figures,
 * percentages, explicit commitments — and deliberately ignores reasoning,
 * hedging, and paraphrase.
 *
 * What it does NOT do: judge whether a grounded fact is *correct*. If the brain
 * says $299 and that is wrong, this guard passes it. Verifying the brain is a
 * human's job; this only enforces that the agent didn't make something up.
 */

export type ClaimKind = "money" | "percentage" | "commitment" | "metric";

export interface UngroundedClaim {
  kind: ClaimKind;
  /** The exact text that failed. */
  text: string;
  /** Plain-language explanation for the operator. */
  reason: string;
}

export interface FactVerdict {
  grounded: boolean;
  claims: UngroundedClaim[];
  /** Correction prompt to retry with, when the caller wants a second attempt. */
  correctionPrompt?: string;
  checkedInMs: number;
}

// ── Extraction ───────────────────────────────────────────────────────────────

/** $299, $2,500, $12.50, USD 299 — the figures that become quotes. */
const MONEY = /(?:\$\s?|USD\s?|usd\s?)(\d[\d,]*(?:\.\d{1,2})?)/g;
/** 60%, 99.5% — margins and SLAs. */
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

/**
 * Phrases that turn an answer into a promise. Matched only when they carry a
 * concrete object (a number or a named thing), so "we guarantee satisfaction"
 * is prose but "we guarantee 99.9% uptime" is a commitment.
 */
const COMMITMENT =
  // The trailing run stops at sentence-ending punctuation, but a period inside
  // a number is not a sentence end — without the lookahead, "99.99% uptime"
  // truncates to "99" and the operator is told the agent promised 99.
  /\b(?:we\s+(?:guarantee|commit\s+to|promise|will\s+deliver)|guaranteed|SLA\s+of|refund\s+within|delivered\s+within)\b(?:[^.!?\n]|\.(?=\d)){0,80}/gi;

/** Normalise a number so "$2,500", "$2500" and "2500.00" compare equal. */
function normaliseNumber(raw: string): string {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : raw;
}

function extractNumbers(text: string, re: RegExp): { text: string; value: string }[] {
  const out: { text: string; value: string }[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], value: normaliseNumber(m[1]) });
  }
  return out;
}

/** Every number that appears anywhere in the grounding text, normalised. */
function groundedNumbers(context: string): Set<string> {
  const set = new Set<string>();
  const all = context.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  for (const raw of all) set.add(normaliseNumber(raw));
  return set;
}

// ── Verification ─────────────────────────────────────────────────────────────

export interface FactCheckOptions {
  /**
   * When false, commitment phrases are not checked. Useful for agents whose
   * whole job is drafting proposals a human will approve — there the promise
   * is the deliverable, and flagging it is noise.
   */
  checkCommitments?: boolean;
}

/**
 * Verify `output` against `context`.
 *
 * `context` must be the grounding text that was actually placed in the system
 * prompt (RoutedContext.groundingText), not a fresh retrieval.
 */
export function verifyOutput(params: {
  output: string;
  context: string;
  options?: FactCheckOptions;
}): FactVerdict {
  const started = Date.now();
  const { output, context } = params;
  const checkCommitments = params.options?.checkCommitments ?? true;

  const claims: UngroundedClaim[] = [];
  const numbers = groundedNumbers(context);

  // Money — the highest-consequence class. An invented price is a contract
  // dispute, so it is checked against exact figures with no tolerance.
  for (const { text, value } of extractNumbers(output, MONEY)) {
    if (!numbers.has(value)) {
      claims.push({
        kind: "money",
        text,
        reason: `${text} does not appear in the knowledge base. An agent may only quote figures it was given.`,
      });
    }
  }

  for (const { text, value } of extractNumbers(output, PERCENT)) {
    if (!numbers.has(value)) {
      claims.push({
        kind: "percentage",
        text,
        reason: `${text} does not appear in the knowledge base.`,
      });
    }
  }

  if (checkCommitments) {
    const alreadyFlagged = new Set(
      claims.map((c) => normaliseNumber((c.text.match(/\d[\d,]*(?:\.\d+)?/) ?? [""])[0]))
    );
    COMMITMENT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COMMITMENT.exec(output)) !== null) {
      const phrase = m[0].trim();
      // A commitment is only a problem when it carries a specific number that
      // isn't grounded. "We guarantee it works" is marketing, not a fact claim.
      const nums = phrase.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
      const ungrounded = nums
        .filter((n) => !numbers.has(normaliseNumber(n)))
        .filter((n) => !alreadyFlagged.has(normaliseNumber(n)));
      if (nums.length > 0 && ungrounded.length > 0) {
        claims.push({
          kind: "commitment",
          text: phrase,
          reason: `This commits the company to ${ungrounded.join(", ")}, which is not in the knowledge base.`,
        });
      }
    }
  }

  const grounded = claims.length === 0;
  return {
    grounded,
    claims,
    correctionPrompt: grounded ? undefined : buildCorrection(claims),
    checkedInMs: Date.now() - started,
  };
}

function buildCorrection(claims: UngroundedClaim[]): string {
  const list = claims.map((c) => `- ${c.text} — ${c.reason}`).join("\n");
  return `Your previous answer contained facts that are NOT in the knowledge base:

${list}

Rewrite your answer. Remove every one of those claims. Use only figures and
commitments that appear verbatim in the IMMUTABLE TRUTH section. If that means
you cannot answer the question, reply exactly:
"I don't have that in the knowledge base."

Do not substitute a different number. Do not hedge the same claim with
"approximately" or "around" — an unsupported figure stays unsupported.`;
}

/** Convenience wrapper for the pipeline: throws nothing, returns a verdict. */
export function isGrounded(output: string, context: string): boolean {
  return verifyOutput({ output, context }).grounded;
}
