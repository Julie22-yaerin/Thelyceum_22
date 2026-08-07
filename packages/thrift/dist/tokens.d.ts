/**
 * Token counting.
 *
 * ── Why this is an estimate, and why that is stated everywhere ──────────────
 * The exact token count for a string depends on the model's tokenizer, and
 * Anthropic's is not published as a local library. Shipping a bundled
 * tokenizer for a different model and presenting its output as "your token
 * count" would be a confident number that is quietly wrong — precisely the
 * failure mode this product exists to prevent elsewhere.
 *
 * So: this is a heuristic, it is labelled `estimated` in every type and every
 * report, and the CLI prints the method next to the number. When you want the
 * real figure, `thrift measure --exact` calls Anthropic's count_tokens
 * endpoint and reports that instead, clearly marked.
 *
 * ── How the heuristic works ─────────────────────────────────────────────────
 * Anthropic's tokenizer averages ~3.6 characters per token on English prose
 * and closer to ~2.8 on dense JSON and code, because punctuation and
 * identifiers fragment. A single chars/4 constant is off by 20-30% on exactly
 * the payloads that matter here (tool output is mostly JSON), so the estimate
 * is weighted by how much of the text looks structural.
 */
export type CountMethod = "heuristic" | "exact";
export interface TokenCount {
    tokens: number;
    method: CountMethod;
    /** Present on heuristic counts, so nobody quotes it as measured. */
    note?: string;
}
/**
 * Estimate tokens for a string.
 *
 * Interpolates between ~3.9 chars/token for prose and ~2.7 for dense
 * structure. Calibrated against Anthropic's published guidance and spot
 * checks; treat it as ±15%, which is why nothing in this package prices a
 * decision on it without saying so.
 */
export declare function estimateTokens(text: string): TokenCount;
/**
 * Ask Anthropic to count exactly.
 *
 * Costs one API call and needs a key. Used when a number is going in front of
 * someone who will act on it — a savings report to a finance team, say —
 * rather than on every compression.
 */
export declare function countExact(text: string, model?: string): Promise<TokenCount>;
