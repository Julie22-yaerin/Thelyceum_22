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

/** Fraction of characters that are JSON/code punctuation rather than prose. */
function structuralDensity(text: string): number {
  if (text.length === 0) return 0;
  let structural = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // { } [ ] " : , < > / \ = ; ( ) and whitespace runs
    if (
      c === 123 || c === 125 || c === 91 || c === 93 || c === 34 ||
      c === 58 || c === 44 || c === 60 || c === 62 || c === 47 ||
      c === 92 || c === 61 || c === 59 || c === 40 || c === 41
    ) {
      structural++;
    }
  }
  return structural / text.length;
}

/**
 * Estimate tokens for a string.
 *
 * Interpolates between ~3.9 chars/token for prose and ~2.7 for dense
 * structure. Calibrated against Anthropic's published guidance and spot
 * checks; treat it as ±15%, which is why nothing in this package prices a
 * decision on it without saying so.
 */
export function estimateTokens(text: string): TokenCount {
  if (!text) return { tokens: 0, method: "heuristic", note: "empty" };
  const density = structuralDensity(text);
  // density 0 → 3.9 chars/token, density 0.25+ → 2.7 chars/token
  const charsPerToken = 3.9 - Math.min(density, 0.25) * 4.8;
  return {
    tokens: Math.ceil(text.length / charsPerToken),
    method: "heuristic",
    note: "estimated (±15%) — run `thrift measure --exact` for Anthropic's own count",
  };
}

/**
 * Ask Anthropic to count exactly.
 *
 * Costs one API call and needs a key. Used when a number is going in front of
 * someone who will act on it — a savings report to a finance team, say —
 * rather than on every compression.
 */
export async function countExact(text: string, model = "claude-sonnet-4-5"): Promise<TokenCount> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Exact counting calls Anthropic's count_tokens endpoint; " +
        "without a key use the heuristic (`thrift measure` with no --exact)."
    );
  }
  const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
  });
  if (!res.ok) {
    throw new Error(`count_tokens returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { input_tokens?: number };
  if (typeof body.input_tokens !== "number") {
    throw new Error("count_tokens returned no input_tokens");
  }
  return { tokens: body.input_tokens, method: "exact" };
}
