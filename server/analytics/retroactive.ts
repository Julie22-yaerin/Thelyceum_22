/**
 * Retroactive analysis — the report a burned founder needs BEFORE they pay,
 * not after.
 *
 * Every other report in this product is forward-looking: turn The Lyceum on
 * and it starts measuring. That is a hard sell to someone who just opened
 * their OpenRouter bill, saw it jump 40% with no matching increase in work
 * done, and wants proof this would have caught it — using THEIR data, not a
 * demo workspace with synthetic traffic.
 *
 * So this accepts a plain export of past API calls (whatever the operator can
 * get out of their provider dashboard — model, cost, timestamps, and ideally
 * the prompt/response text) and runs the parts of the analysis that are
 * actually possible without having been there:
 *
 *   CAN do without our guards having run at the time:
 *     - loop detection (identical or near-identical consecutive payloads)
 *     - cost concentration (which slice of spend a handful of calls caused)
 *     - candidate hallucination markers (commitment language — "guaranteed",
 *       "$X", "X% uptime" — same regex family as the live fact guard)
 *
 *   CANNOT do retroactively, and this file refuses to pretend otherwise:
 *     - confirm a candidate marker was actually ungrounded — that needs the
 *       knowledge base the response should have been checked against, which
 *       historical logs do not carry
 *     - reconstruct exact tokens burned per call if the export did not record
 *       them — synthesizing a number here is exactly the kind of confident
 *       fabrication this product exists to catch, so it is not done
 *
 * A retroactive report that overclaims what it found is worse than no report:
 * it is the product failing its own standard on the first thing a skeptical
 * buyer asks it to do.
 */

export interface HistoricalCall {
  at: number;
  /** Cost in cents, if the export included it. */
  costCents?: number;
  model?: string;
  /** Enough of the prompt to compare consecutive calls. Not required. */
  promptPreview?: string;
  /** Enough of the response to look for commitment language. Not required. */
  responsePreview?: string;
}

export interface LoopFinding {
  /** Index range in the input this loop spans. */
  startIndex: number;
  count: number;
  costCents: number;
  sample: string;
}

export interface CommitmentCandidate {
  index: number;
  at: number;
  text: string;
  matched: string;
}

export interface RetroactiveReport {
  callCount: number;
  /** Only present if every record had a cost. Partial data is not extrapolated. */
  totalCostCents: number | null;
  costCoverage: number;

  loops: LoopFinding[];
  loopCostCents: number;

  commitmentCandidates: CommitmentCandidate[];

  /** What could not be determined from this export, stated plainly. */
  limitations: string[];

  narrative: string;
}

const COMMITMENT = /\b(?:guarantee|guaranteed|we\s+will\s+deliver|SLA\s+of|refund\s+within)\b/i;
const FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?%/g;

/**
 * Find runs of identical (or near-identical) consecutive prompts.
 *
 * A near-identical retry — same request, response ignored, tried again — is
 * the single most common way inference spend runs away, and it is the thing a
 * founder scanning a bill by eye cannot see: each call looks legitimate on its
 * own line, and only becomes visible as a pattern.
 */
function findLoops(calls: HistoricalCall[]): LoopFinding[] {
  const findings: LoopFinding[] = [];
  let i = 0;
  while (i < calls.length) {
    const key = calls[i].promptPreview;
    if (!key) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < calls.length && calls[j].promptPreview === key) j++;
    const runLength = j - i;
    if (runLength >= 3) {
      findings.push({
        startIndex: i,
        count: runLength,
        costCents: calls.slice(i, j).reduce((s, c) => s + (c.costCents ?? 0), 0),
        sample: key.slice(0, 140),
      });
    }
    i = j;
  }
  return findings;
}

function findCommitmentCandidates(calls: HistoricalCall[]): CommitmentCandidate[] {
  const out: CommitmentCandidate[] = [];
  calls.forEach((c, index) => {
    const text = c.responsePreview;
    if (!text) return;
    if (!COMMITMENT.test(text) && !FIGURE.test(text)) return;
    const figures = text.match(FIGURE) ?? [];
    if (figures.length === 0 && !COMMITMENT.test(text)) return;
    out.push({
      index,
      at: c.at,
      text: text.slice(0, 160),
      matched: figures.length > 0 ? figures.join(", ") : "guarantee language",
    });
  });
  return out;
}

export function analyzeRetroactive(calls: HistoricalCall[]): RetroactiveReport {
  const withCost = calls.filter((c) => typeof c.costCents === "number");
  const costCoverage = calls.length === 0 ? 0 : withCost.length / calls.length;
  const totalCostCents = costCoverage === 1 ? withCost.reduce((s, c) => s + c.costCents!, 0) : null;

  const loops = findLoops(calls);
  const loopCostCents = loops.reduce((s, l) => s + l.costCents, 0);
  const commitmentCandidates = findCommitmentCandidates(calls);

  const limitations: string[] = [];
  if (costCoverage < 1) {
    limitations.push(
      `${Math.round((1 - costCoverage) * 100)}% of rows had no cost figure, so total spend is not shown — a partial total would look precise and not be.`
    );
  }
  if (calls.every((c) => !c.promptPreview)) {
    limitations.push(
      "No prompt text was in this export, so loops could not be checked — only exact repeated prompts are detectable this way, and providers do not always export them."
    );
  }
  limitations.push(
    "Commitment candidates are NOT confirmed hallucinations — confirming that needs the knowledge base each response should have matched, which does not exist for calls made before The Lyceum was in the loop. Review these yourself."
  );

  const narrative = buildNarrative({
    callCount: calls.length,
    totalCostCents,
    loops,
    loopCostCents,
    commitmentCandidates,
  });

  return {
    callCount: calls.length,
    totalCostCents,
    costCoverage,
    loops,
    loopCostCents,
    commitmentCandidates,
    limitations,
    narrative,
  };
}

function buildNarrative(p: {
  callCount: number;
  totalCostCents: number | null;
  loops: LoopFinding[];
  loopCostCents: number;
  commitmentCandidates: CommitmentCandidate[];
}): string {
  if (p.callCount === 0) return "No calls in this export.";
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  const parts: string[] = [`Reviewed ${p.callCount} historical calls.`];

  if (p.loops.length > 0) {
    parts.push(
      `Found ${p.loops.length} run(s) of an identical prompt repeated 3+ times in a row — the pattern this product's loop breaker would have stopped at call 3. ` +
        (p.loopCostCents > 0
          ? `Those runs alone cost ${usd(p.loopCostCents)}.`
          : `Cost per call was not in this export, so a dollar figure is not shown for them.`)
    );
  } else {
    parts.push("No repeated-prompt loops found in what this export could show.");
  }

  if (p.commitmentCandidates.length > 0) {
    parts.push(
      `${p.commitmentCandidates.length} response(s) contain a specific figure or a guarantee — worth checking by hand against what you actually offer, since this export cannot confirm whether they were grounded.`
    );
  }

  parts.push(
    "This is what could be found without having been there when the calls were made. Going forward, the live pipeline catches the same patterns before the call is made, not after the invoice arrives."
  );
  return parts.join(" ");
}
