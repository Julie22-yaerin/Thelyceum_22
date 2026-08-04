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
 *                  what was cut and how to get it. Windows snap to literal
 *                  boundaries — a string/template/comment is never cut in half.
 *   3. STRIP       Machine noise with no semantic content: repeated
 *                  indentation, base64 blobs, lockfile hashes, ANSI codes,
 *                  duplicate log lines.
 *   4. CAP         Nothing else worked and it is still enormous. Truncate at a
 *                  budget, and say so loudly in the payload so the model knows
 *                  it is looking at a fragment.
 *
 * ── The iron rule: hard data is only ever deduped ──────────────────────────
 * Immutable facts — JSON schema, code, variable names, financial limits,
 * credentials — must survive byte-identical. They may be DEDUPED (a pointer to
 * content already in context) but never truncated. Only prose (semantic text)
 * is compressible. So CAP is hard-data-aware: in a mixed payload it trims
 * whole soft lines while keeping every hard line intact, and when hard data
 * alone overflows the budget it drops whole lines — never a line split in
 * half — with a marker naming exactly what happened. See classify.ts.
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
import { classify, type Classification } from "./classify.js";

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
  /**
   * Tokens of the INPUT payload that are immutable hard data (code, JSON
   * schema, limits, credentials) — the part that is never truncated.
   */
  hardTokens: number;
  /** Tokens of the input payload that are compressible prose. */
  softTokens: number;
  /** hardTokens / (hardTokens + softTokens); 0 when there is no hard data. */
  hardFraction: number;
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
  /**
   * Max tool calls a dedupe pointer stays valid. Default 20.
   *
   * The host (Claude Desktop, Claude Code, …) can compact or evict context at
   * any moment. A pointer that says "you already have this" when the content
   * has since left the context window is the worst failure thrift can have —
   * unrecoverable, because the model cannot fetch what it was never given. So
   * a pointer expires: after this many intervening calls, the full content is
   * re-sent and the sighting re-baselined.
   */
  maxDedupeAgeCalls?: number;
  /**
   * Max tokens emitted (across ALL thrift results this session) since a
   * sighting while its pointer stays valid. Default 40000.
   *
   * A call-count window cannot see context pressure; a token budget can. This
   * is a proxy — thrift cannot know the host's actual window size — so it is
   * deliberately conservative: if a lot of new content has entered context
   * since the sighting, the earlier copy may well be gone.
   */
  maxDedupeAgeTokens?: number;
  /** Disable individual mechanisms. Off means "never fire". */
  enable?: Partial<Record<Exclude<Mechanism, "none">, boolean>>;
}

/** Default expiry window for a dedupe pointer, in tool calls. */
export const DEFAULT_MAX_DEDUPE_AGE_CALLS = 20;
/** Default expiry window for a dedupe pointer, in tokens emitted since. */
export const DEFAULT_MAX_DEDUPE_AGE_TOKENS = 40_000;

// ── 1. Dedupe ────────────────────────────────────────────────────────────────

interface SeenEntry {
  hash: string;
  atCall: number;
  /** Cumulative emitted tokens at the moment this content was shown. */
  emittedAt: number;
  tokens: number;
}

/**
 * Per-session memory of what the agent has already been shown.
 *
 * In-process and per-session on purpose: this must reset when the conversation
 * does. Persisting it across sessions would make thrift tell a fresh
 * conversation "you already have this file", which is false and unrecoverable
 * — the model has no way to fetch what it was never given.
 *
 * ── Why it tracks emitted tokens as well as call counts ─────────────────────
 * The host can compact context at any moment, and thrift cannot see the
 * conversation to know when. So each sighting records how much new content has
 * been emitted since it — a conservative proxy for "is it still in context".
 * A pointer is only handed out while BOTH the call window and the token window
 * are open; once either closes, the full content is re-sent.
 */
export class SeenLedger {
  private seen = new Map<string, SeenEntry>();
  private calls = 0;
  /** Cumulative tokens of every result returned this session. */
  private emitted = 0;

  get callCount(): number {
    return this.calls;
  }

  get emittedTokens(): number {
    return this.emitted;
  }

  reset(): void {
    this.seen.clear();
    this.calls = 0;
    this.emitted = 0;
  }

  size(): number {
    return this.seen.size;
  }

  /** Call after a result is returned to the model, so age-in-tokens stays honest. */
  recordEmission(tokens: number): void {
    this.emitted += Math.max(0, tokens);
  }

  /** Returns the prior sighting if this exact content was already shown. */
  check(sourceId: string, text: string): SeenEntry | null {
    this.calls++;
    const hash = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
    const prior = this.seen.get(sourceId);
    if (prior && prior.hash === hash) return prior;
    this.seen.set(sourceId, {
      hash,
      atCall: this.calls,
      emittedAt: this.emitted,
      tokens: estimateTokens(text).tokens,
    });
    return null;
  }

  /**
   * Refresh a sighting after the full content was re-sent, so the next read
   * within the window can dedupe again.
   */
  rebaseline(sourceId: string, tokens: number): void {
    const entry = this.seen.get(sourceId);
    if (entry) {
      entry.atCall = this.calls;
      entry.emittedAt = this.emitted;
      entry.tokens = tokens;
    }
  }
}

// ── 2. Slice ─────────────────────────────────────────────────────────────────

/**
 * Keep the windows around query terms, drop the rest.
 *
 * Line-based rather than character-based so code stays syntactically legible,
 * and gaps are marked with the exact line range removed so the model can ask
 * for a specific span rather than re-requesting the whole file.
 *
 * Boundaries are SYNTAX-AWARE: a window must never cut through a multi-line
 * string literal, template literal, or block comment. A model handed half of
 * a literal cannot parse what it sees, and no gap marker fixes an unterminated
 * literal — the content is broken no matter how precisely the range is named.
 * So each kept run is snapped outward until both edges sit at literal
 * boundaries; if that would keep too much, we decline to slice.
 */

type ScanMode = "code" | "sq" | "dq" | "tpl" | "block" | "line";

interface LineScan {
  /** Line i begins inside a literal/comment opened on an earlier line. */
  startInside: boolean[];
  /** Line i ends inside a literal/comment that continues onto the next line. */
  endInside: boolean[];
}

/**
 * Walk the file once tracking quote/template/comment state per line.
 *
 * Conservative by design: on anything ambiguous it stays "inside", because the
 * cost of over-keeping is a few extra lines, while the cost of cutting a
 * literal in half is broken syntax the model cannot repair. One known
 * consequence: a stray apostrophe in prose opens a single-quote span that
 * closes at the next apostrophe, over-keeping in between — that is the safe
 * direction, so do not "fix" it by guessing.
 */
function scanLiterals(lines: string[]): LineScan {
  const startInside: boolean[] = new Array(lines.length).fill(false);
  const endInside: boolean[] = new Array(lines.length).fill(false);
  let mode: ScanMode = "code";
  let tplBraces = 0; // depth of ${…} interpolation inside the current template
  const inside = (m: ScanMode): boolean =>
    m === "sq" || m === "dq" || m === "tpl" || m === "block";

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    startInside[li] = inside(mode);
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const next = line[i + 1];
      switch (mode) {
        case "code":
          if (c === "/" && next === "/") { mode = "line"; i++; }
          else if (c === "/" && next === "*") { mode = "block"; i++; }
          else if (c === "'") mode = "sq";
          else if (c === '"') mode = "dq";
          else if (c === "`") { mode = "tpl"; tplBraces = 0; }
          break;
        case "sq":
          if (c === "\\") i++;
          else if (c === "'") mode = "code";
          break;
        case "dq":
          if (c === "\\") i++;
          else if (c === '"') mode = "code";
          break;
        case "tpl":
          if (c === "\\") i++;
          else if (c === "`" && tplBraces === 0) mode = "code";
          else if (c === "$" && next === "{") { tplBraces++; i++; }
          else if (c === "{" && tplBraces > 0) tplBraces++;
          else if (c === "}" && tplBraces > 0) tplBraces--;
          break;
        case "block":
          if (c === "*" && next === "/") { mode = "code"; i++; }
          break;
        case "line":
          break; // // comment ends at the newline
      }
    }
    if (mode === "line") mode = "code"; // a // comment cannot span lines
    endInside[li] = inside(mode);
  }
  return { startInside, endInside };
}

/** Extend every kept run outward until its edges sit at literal boundaries. */
function snapRuns(keep: Set<number>, lines: string[], scan: LineScan): void {
  let runStart = -1;
  for (let i = 0; i <= lines.length; i++) {
    const kept = i < lines.length && keep.has(i);
    if (kept && runStart === -1) runStart = i;
    if (!kept && runStart !== -1) {
      let a = runStart;
      let b = i - 1;
      while (a > 0 && scan.startInside[a]) a--; // back to the literal's opening line
      while (b < lines.length - 1 && scan.endInside[b]) b++; // forward to its closing line
      for (let j = a; j <= b; j++) keep.add(j);
      runStart = -1;
    }
  }
}

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

  // Never cut a literal in half — snap the windows to literal boundaries first.
  snapRuns(keep, lines, scanLiterals(lines));
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
      // The lookarounds matter: a run that is a SEGMENT of a larger token — a
      // JWT (header.payload.signature), a base64url identifier — carries facts
      // the model may need (sub, role, exp). Adjacent `.` `-` `_` mean "part of
      // something bigger", so those runs are left alone. Only a run that stands
      // alone (space, quote, line edge) is machine noise.
      .replace(
        /(?<![A-Za-z0-9+/._-])[A-Za-z0-9+/]{200,}={0,2}(?![A-Za-z0-9+/._-])/g,
        (m) => `[thrift: ${m.length}-char base64 omitted]`
      )
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

interface CapOutcome {
  text: string;
  /** True when the payload was mixed and every hard line survived intact. */
  hardProtected: boolean;
}

/**
 * The hard-data-aware cap — the iron rule in code.
 *
 *   • Uniform payload (all hard or all soft): nothing to trim first, so the
 *     plain head+tail cap applies, exactly as before.
 *   • Mixed payload: keep EVERY hard line; drop the soft prose, with a marker
 *     saying how much prose was cut and that the code/config/limits are intact.
 *   • If even the hard data alone overflows the budget, drop whole hard lines
 *     from the middle (head+tail kept) — a line is never split in half — and
 *     say so loudly. A split line is corrupted syntax the model cannot repair;
 *     a dropped line is at least a known, named absence.
 */
function capRespectingHard(text: string, budgetTokens: number, cls: Classification): CapOutcome {
  const est = estimateTokens(text);
  if (est.tokens <= budgetTokens) return { text, hardProtected: false };

  if (cls.hardTokens === 0 || cls.softTokens === 0) {
    // Uniform dump — the pre-iron-rule behavior, unchanged.
    return { text: cap(text, budgetTokens), hardProtected: false };
  }

  // Mixed: keep hard lines, drop the prose in between.
  const hardLines: string[] = [];
  let droppedSoft = 0;
  for (const l of cls.lines) {
    if (l.kind === "hard") hardLines.push(l.text);
    else droppedSoft++;
  }

  const hardJoined = hardLines.join("\n");
  if (estimateTokens(hardJoined).tokens <= budgetTokens) {
    const proseMarker =
      droppedSoft > 0
        ? `[thrift: ${droppedSoft} line${droppedSoft === 1 ? "" : "s"} of prose omitted so the ` +
          `hard data below stays intact — code, config, limits, credentials are ` +
          `byte-identical. Ask for the prose if you need it.]\n\n`
        : "";
    return { text: proseMarker + hardJoined, hardProtected: true };
  }

  // Hard data alone overflows. Drop whole hard lines from the middle — never
  // split one — and name the loss exactly.
  const ratio = budgetTokens / estimateTokens(hardJoined).tokens;
  const keepCount = Math.max(1, Math.floor(hardLines.length * ratio * 0.94));
  const headCount = Math.min(hardLines.length, Math.floor(keepCount * 0.7));
  const tailCount = Math.max(0, keepCount - headCount);
  const head = hardLines.slice(0, headCount);
  const tail = hardLines.slice(Math.max(headCount, hardLines.length - tailCount));
  const omitted = hardLines.length - head.length - tail.length;
  const marker =
    `[thrift: even the hard data exceeded the ${budgetTokens.toLocaleString()}-token budget, ` +
    `so ${omitted.toLocaleString()} whole line${omitted === 1 ? "" : "s"} were dropped from the middle — ` +
    `never split. This is a FRAGMENT. Raise the budget or ask for a specific range.]\n\n`;
  return { text: [...head, marker, ...tail].join("\n"), hardProtected: true };
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
  const maxDedupeAgeCalls = options.maxDedupeAgeCalls ?? DEFAULT_MAX_DEDUPE_AGE_CALLS;
  const maxDedupeAgeTokens = options.maxDedupeAgeTokens ?? DEFAULT_MAX_DEDUPE_AGE_TOKENS;
  const enable = {
    dedupe: options.enable?.dedupe !== false,
    slice: options.enable?.slice !== false,
    strip: options.enable?.strip !== false,
    cap: options.enable?.cap !== false,
  };

  const before = estimateTokens(text);
  // Metrics of the INPUT payload: what share of it is immutable hard data.
  // Computed once, reported on every return path.
  const cls = classify(text);
  const applied: Mechanism[] = [];
  // True when dedupe matched but the pointer had expired — used to say so in
  // the note instead of the misleading "already lean, nothing to remove".
  let dedupeExpired = false;
  // True when CAP ran on a mixed payload and every hard line survived intact.
  let hardProtected = false;

  // 1. DEDUPE — lossless, and by far the largest win in a real agent loop.
  if (enable.dedupe && options.sourceId) {
    const prior = ledger.check(options.sourceId, text);
    if (prior) {
      const ageCalls = ledger.callCount - prior.atCall;
      // Tokens of OTHER content emitted since the sighting. The sighting's own
      // first emission is subtracted: a file that was just read in full is
      // definitely still in context, and counting its own tokens against its
      // own expiry would refuse dedupe on a 50k-token file read twice in a row.
      const ageTokens = Math.max(0, ledger.emittedTokens - prior.emittedAt - prior.tokens);
      const withinWindow =
        ageCalls <= maxDedupeAgeCalls && ageTokens <= maxDedupeAgeTokens;
      if (withinWindow) {
        const pointer =
          `[thrift: unchanged since you read it earlier this session ` +
          `(${prior.tokens.toLocaleString()} tokens, call #${prior.atCall}, ` +
          `${ageCalls} call${ageCalls === 1 ? "" : "s"} ago). ` +
          `Content omitted because you already have it. Say "re-read ${options.sourceId} in full" if you need it again.]`;
        const after = estimateTokens(pointer);
        ledger.recordEmission(after.tokens);
        return {
          text: pointer,
          applied: ["dedupe"],
          before,
          after,
          saved: before.tokens - after.tokens,
          savedFraction: before.tokens > 0 ? (before.tokens - after.tokens) / before.tokens : 0,
          hardTokens: cls.hardTokens,
          softTokens: cls.softTokens,
          hardFraction: cls.hardFraction,
          note: `Already in your context — returned a pointer instead of ${prior.tokens.toLocaleString()} tokens.`,
        };
      }
      // Pointer expired: the host may have compacted the earlier copy out of
      // the context window, so "you already have this" can no longer be
      // trusted. Re-send the full content and re-baseline the sighting so the
      // NEXT read within the window can dedupe again.
      dedupeExpired = true;
      ledger.rebaseline(options.sourceId, estimateTokens(text).tokens);
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

  // 4. CAP — last resort, loudly announced, and hard-data-aware: in a mixed
  // payload it trims prose only, never truncates a line of code/config/limits.
  if (enable.cap) {
    const outcome = capRespectingHard(working, budgetTokens, cls);
    if (outcome.text !== working) {
      working = outcome.text;
      applied.push("cap");
      if (outcome.hardProtected) hardProtected = true;
    }
  }

  const guarded = guardAgainstGrowth(text, working);
  if (guarded.grew) {
    ledger.recordEmission(before.tokens);
    return {
      text,
      applied: [],
      before,
      after: before,
      saved: 0,
      savedFraction: 0,
      hardTokens: cls.hardTokens,
      softTokens: cls.softTokens,
      hardFraction: cls.hardFraction,
      note: dedupeExpired
        ? "Pointer expired (too many calls / tokens since the earlier read) — full content re-sent in case it left the context window."
        : "Already lean — compressing would have cost more tokens than it saved.",
    };
  }

  const after = estimateTokens(guarded.text);
  const saved = before.tokens - after.tokens;
  ledger.recordEmission(after.tokens);
  const hardPct = Math.round(cls.hardFraction * 100);
  const mechNote = `${applied.join(" + ")} → saved ~${saved.toLocaleString()} tokens (${Math.round(
    (saved / Math.max(before.tokens, 1)) * 100
  )}%). Estimated, ±15%.`;
  const hardNote =
    hardProtected
      ? ` Hard data kept byte-identical: ${cls.hardTokens.toLocaleString()} tokens (${hardPct}% of the payload) of code/config/limits were protected — only prose was cut.`
      : cls.hardTokens > 0
        ? ` Payload is ${hardPct}% immutable hard data — dedupe is the only mechanism that may ever remove it.`
        : "";
  return {
    text: guarded.text,
    applied: applied.length > 0 ? applied : ["none"],
    before,
    after,
    saved,
    savedFraction: before.tokens > 0 ? saved / before.tokens : 0,
    hardTokens: cls.hardTokens,
    softTokens: cls.softTokens,
    hardFraction: cls.hardFraction,
    note:
      applied.length === 0
        ? dedupeExpired
          ? "Pointer expired (too many calls / tokens since the earlier read) — full content re-sent in case it left the context window."
          : "Already lean — nothing to remove."
        : dedupeExpired
          ? `${mechNote}${hardNote} (The earlier copy's pointer had expired, so the full content was re-sent first.)`
          : `${mechNote}${hardNote}`,
  };
}
