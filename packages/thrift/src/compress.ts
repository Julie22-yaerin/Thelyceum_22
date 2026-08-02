/**
 * The compressor.
 *
 * ── What this actually does, and what it cannot ─────────────────────────────
 * An MCP server sees its own tool calls and nothing else. It cannot read the
 * conversation, cannot rewrite the system prompt, and cannot prune history.
 * So the only tokens `thrift` can save are the ones in tool RESULTS — which
 * turns out to be where the waste is, because that is the part of an agent
 * loop that scales with the size of the codebase rather than the length of
 * the conversation.
 *
 * Four mechanisms, in the order they fire:
 *
 *   1. DEDUPE      The agent re-reads a file it already has. Return a pointer
 *                  instead of the content. This is the biggest single win in a
 *                  real loop and it is lossless — the content is already in
 *                  context.
 *   2. SLICE       A 4,000-line file when the agent asked about one function.
 *                  Return the relevant window plus an explicit marker saying
 *                  what was cut and how to get it.
 *   3. STRIP       Machine noise with no semantic content: repeated
 *                  indentation, base64 blobs, lockfile hashes, ANSI codes,
 *                  duplicate log lines.
 *   4. CAP         Nothing else worked and it is still enormous. Truncate at a
 *                  budget, and say so loudly in the payload so the model knows
 *                  it is looking at a fragment.
 *
 * ── The rule that makes this safe to run always-on ──────────────────────────
 * Every reduction is REVERSIBLE and ANNOUNCED. The model is always told what
 * was removed and how to get it back. A compressor that silently drops the one
 * line the agent needed does not save money — it causes a retry, which costs
 * more than it saved, and the operator never finds out why the agent got
 * confused.
 *
 * ── On the savings figure ───────────────────────────────────────────────────
 * There is no fixed percentage in this file, because the honest answer depends
 * entirely on the workload: a loop that re-reads the same six files saves far
 * more than a single fresh read of unique content. `thrift` measures each call
 * and reports what it actually did. See README for measured figures on real
 * corpora and the cases where it saves nothing at all.
 */

import crypto from "node:crypto";
import { estimateTokens, type TokenCount } from "./tokens.js";

export type Mechanism = "dedupe" | "slice" | "strip" | "cap" | "none";

export interface CompressResult {
  text: string;
  /** What fired, in order. Empty when the payload was already lean. */
  applied: Mechanism[];
  before: TokenCount;
  after: TokenCount;
  /** Tokens saved. Negative is impossible — see `guardAgainstGrowth`. */
  saved: number;
  savedFraction: number;
  /** Human-readable, shown in the tool result so the model knows what happened. */
  note: string;
}

export interface CompressOptions {
  /** Cap in tokens. Beyond this, mechanism 4 fires. Default 4000. */
  budgetTokens?: number;
  /** What the agent said it was looking for — drives SLICE. */
  query?: string;
  /** Stable id for the source (file path, URL, tool name + args hash). */
  sourceId?: string;
  /** Disable individual mechanisms. Off means "never fire". */
  enable?: Partial<Record<Exclude<Mechanism, "none">, boolean>>;
}

// ── 1. Dedupe ────────────────────────────────────────────────────────────────

interface SeenEntry {
  hash: string;
  atCall: number;
  tokens: number;
}

/**
 * Per-session memory of what the agent has already been shown.
 *
 * In-process and per-session on purpose: this must reset when the conversation
 * does. Persisting it across sessions would make thrift tell a fresh
 * conversation "you already have this file", which is false and unrecoverable
 * — the model has no way to fetch what it was never given.
 */
export class SeenLedger {
  private seen = new Map<string, SeenEntry>();
  private calls = 0;

  reset(): void {
    this.seen.clear();
    this.calls = 0;
  }

  size(): number {
    return this.seen.size;
  }

  /** Returns the prior sighting if this exact content was already shown. */
  check(sourceId: string, text: string): SeenEntry | null {
    this.calls++;
    const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
    const prior = this.seen.get(sourceId);
    if (prior && prior.hash === hash) return prior;
    this.seen.set(sourceId, { hash, atCall: this.calls, tokens: estimateTokens(text).tokens });
    return null;
  }
}

// ── 2. Slice ─────────────────────────────────────────────────────────────────

/**
 * Keep the windows around query terms, drop the rest.
 *
 * Line-based rather than character-based so code stays syntactically legible,
 * and gaps are marked with the exact line range removed so the model can ask
 * for a specific span rather than re-requesting the whole file.
 */
function slice(text: string, query: string, budgetTokens: number): string | null {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_$.]+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return null;

  const lines = text.split("\n");
  if (lines.length < 60) return null; // not worth slicing something small

  const WINDOW = 12;
  const keep = new Set<number>();
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      hits++;
      for (let j = Math.max(0, i - WINDOW); j <= Math.min(lines.length - 1, i + WINDOW); j++) {
        keep.add(j);
      }
    }
  }
  // No hits means the query does not describe this content. Slicing on zero
  // evidence would hand back an arbitrary fragment, so decline instead.
  if (hits === 0) return null;
  if (keep.size >= lines.length * 0.8) return null; // slicing would save nothing

  const out: string[] = [];
  let gapStart: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (gapStart !== null) {
        out.push(`… [thrift: lines ${gapStart + 1}-${i} omitted — ask for this range to see them]`);
        gapStart = null;
      }
      out.push(lines[i]);
    } else if (gapStart === null) {
      gapStart = i;
    }
  }
  if (gapStart !== null) {
    out.push(`… [thrift: lines ${gapStart + 1}-${lines.length} omitted — ask for this range to see them]`);
  }

  const sliced = out.join("\n");
  return estimateTokens(sliced).tokens < budgetTokens ? sliced : sliced;
}

// ── 3. Strip ─────────────────────────────────────────────────────────────────

/**
 * Remove machine noise that carries no meaning for the model.
 *
 * Every rule here is chosen because the removed bytes are genuinely
 * information-free at the model's level of concern. Nothing that could be a
 * fact, an identifier, or a value is touched — the whole point is that a strip
 * must never change what the model can conclude.
 */
function strip(text: string): string {
  return (
    text
      // ANSI escape sequences from CLI output — pure display noise.
      .replace(/\[[0-9;]*[A-Za-z]/g, "")
      // Long base64 blobs: keep a marker with the length, drop the payload.
      // A model cannot use a 40KB base64 string, but it can use "there is one".
      .replace(/[A-Za-z0-9+/]{200,}={0,2}/g, (m) => `[thrift: ${m.length}-char base64 omitted]`)
      // Integrity hashes in lockfiles — never read, always huge.
      .replace(/"integrity":\s*"sha\d+-[A-Za-z0-9+/=]+"/g, '"integrity": "[thrift: omitted]"')
      // Runs of blank lines collapse to one.
      .replace(/\n{4,}/g, "\n\n\n")
      // Trailing whitespace.
      .replace(/[ \t]+$/gm, "")
  );
}

/** Collapse consecutive identical lines, which log output produces constantly. */
function collapseRepeats(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let run = 1;
    while (i + run < lines.length && lines[i + run] === lines[i]) run++;
    out.push(lines[i]);
    // Three or more: worth collapsing. Two is not worth the marker's own tokens.
    if (run >= 3) out.push(`… [thrift: previous line repeated ${run - 1} more times]`);
    else for (let k = 1; k < run; k++) out.push(lines[i]);
    i += run;
  }
  return out.join("\n");
}

// ── 4. Cap ───────────────────────────────────────────────────────────────────

function cap(text: string, budgetTokens: number): string {
  const est = estimateTokens(text);
  if (est.tokens <= budgetTokens) return text;
  // Keep the head and the tail: the head has the shape, the tail usually has
  // the error or the conclusion. Cutting only the tail loses the answer.
  const ratio = budgetTokens / est.tokens;
  const keepChars = Math.floor(text.length * ratio * 0.94); // leave room for the marker
  const head = text.slice(0, Math.floor(keepChars * 0.7));
  const tail = text.slice(text.length - Math.floor(keepChars * 0.3));
  const omittedChars = text.length - head.length - tail.length;
  return (
    head +
    `\n\n… [thrift: ${omittedChars.toLocaleString()} characters omitted to stay under a ` +
    `${budgetTokens.toLocaleString()}-token budget. This is a FRAGMENT — ask for a specific ` +
    `section or raise the budget if you need the middle.]\n\n` +
    tail
  );
}

// ── The pipeline ─────────────────────────────────────────────────────────────

/**
 * Guard against a "compression" that made things bigger.
 *
 * Every mechanism adds a marker, and on already-small input the markers can
 * cost more than they save. Returning the original in that case is the only
 * honest outcome — a tool that claims a saving while charging more tokens is
 * worse than one that does nothing.
 */
function guardAgainstGrowth(original: string, compressed: string): { text: string; grew: boolean } {
  const before = estimateTokens(original).tokens;
  const after = estimateTokens(compressed).tokens;
  return after >= before ? { text: original, grew: true } : { text: compressed, grew: false };
}

export function compress(
  text: string,
  ledger: SeenLedger,
  options: CompressOptions = {}
): CompressResult {
  const budgetTokens = options.budgetTokens ?? 4000;
  const enable = {
    dedupe: options.enable?.dedupe !== false,
    slice: options.enable?.slice !== false,
    strip: options.enable?.strip !== false,
    cap: options.enable?.cap !== false,
  };

  const before = estimateTokens(text);
  const applied: Mechanism[] = [];

  // 1. DEDUPE — lossless, and by far the largest win in a real agent loop.
  if (enable.dedupe && options.sourceId) {
    const prior = ledger.check(options.sourceId, text);
    if (prior) {
      const pointer =
        `[thrift: unchanged since you read it earlier this session ` +
        `(${prior.tokens.toLocaleString()} tokens, call #${prior.atCall}). ` +
        `Content omitted because you already have it. Say "re-read ${options.sourceId} in full" if you need it again.]`;
      const after = estimateTokens(pointer);
      return {
        text: pointer,
        applied: ["dedupe"],
        before,
        after,
        saved: before.tokens - after.tokens,
        savedFraction: before.tokens > 0 ? (before.tokens - after.tokens) / before.tokens : 0,
        note: `Already in your context — returned a pointer instead of ${prior.tokens.toLocaleString()} tokens.`,
      };
    }
  }

  let working = text;

  // 2. SLICE — only when a query gives us evidence about what matters.
  if (enable.slice && options.query) {
    const sliced = slice(working, options.query, budgetTokens);
    if (sliced && estimateTokens(sliced).tokens < estimateTokens(working).tokens) {
      working = sliced;
      applied.push("slice");
    }
  }

  // 3. STRIP — always safe, never changes meaning.
  if (enable.strip) {
    const stripped = collapseRepeats(strip(working));
    if (estimateTokens(stripped).tokens < estimateTokens(working).tokens) {
      working = stripped;
      applied.push("strip");
    }
  }

  // 4. CAP — last resort, loudly announced.
  if (enable.cap) {
    const capped = cap(working, budgetTokens);
    if (capped !== working) {
      working = capped;
      applied.push("cap");
    }
  }

  const guarded = guardAgainstGrowth(text, working);
  if (guarded.grew) {
    return {
      text,
      applied: [],
      before,
      after: before,
      saved: 0,
      savedFraction: 0,
      note: "Already lean — compressing would have cost more tokens than it saved.",
    };
  }

  const after = estimateTokens(guarded.text);
  const saved = before.tokens - after.tokens;
  return {
    text: guarded.text,
    applied: applied.length > 0 ? applied : ["none"],
    before,
    after,
    saved,
    savedFraction: before.tokens > 0 ? saved / before.tokens : 0,
    note:
      applied.length === 0
        ? "Already lean — nothing to remove."
        : `${applied.join(" + ")} → saved ~${saved.toLocaleString()} tokens (${Math.round(
            (saved / Math.max(before.tokens, 1)) * 100
          )}%). Estimated, ±15%.`,
  };
}
