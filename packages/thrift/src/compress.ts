/**
 * The compressor.
 */

import crypto from "node:crypto";
import { estimateTokens, type TokenCount } from "./tokens.js";
import { classify, type Classification } from "./classify.js";
import { filterProseNoise } from "./prose.js";

export type Mechanism = "dedupe" | "slice" | "strip" | "cap" | "none";

export interface CompressResult {
  text: string;
  applied: Mechanism[];
  before: TokenCount;
  after: TokenCount;
  saved: number;
  savedFraction: number;
  hardTokens: number;
  softTokens: number;
  hardFraction: number;
  note: string;
}

export interface CompressOptions {
  budgetTokens?: number;
  query?: string;
  sourceId?: string;
  maxDedupeAgeCalls?: number;
  maxDedupeAgeTokens?: number;
  enable?: Partial<Record<Exclude<Mechanism, "none">, boolean>>;
}

export const DEFAULT_MAX_DEDUPE_AGE_CALLS = 20;
export const DEFAULT_MAX_DEDUPE_AGE_TOKENS = 40_000;

interface SeenEntry {
  hash: string;
  atCall: number;
  emittedAt: number;
  tokens: number;
}

export class SeenLedger {
  private seen = new Map<string, SeenEntry>();
  private calls = 0;
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

  recordEmission(tokens: number): void {
    this.emitted += Math.max(0, tokens);
  }

  check(sourceId: string, text: string): SeenEntry | null {
    this.calls++;
    const normalized = text.replace(/\r\n/g, "\n");
    const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
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

  rebaseline(sourceId: string, tokens: number): void {
    const entry = this.seen.get(sourceId);
    if (entry) {
      entry.atCall = this.calls;
      entry.emittedAt = this.emitted;
      entry.tokens = tokens;
    }
  }
}

type ScanMode = "code" | "sq" | "dq" | "tpl" | "block" | "line";

interface LineScan {
  startInside: boolean[];
  endInside: boolean[];
}

function scanLiterals(lines: string[]): LineScan {
  const startInside: boolean[] = new Array(lines.length).fill(false);
  const endInside: boolean[] = new Array(lines.length).fill(false);
  let mode: ScanMode = "code";
  let tplBraces = 0;
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
          break;
      }
    }
    if (mode === "line") mode = "code";
    endInside[li] = inside(mode);
  }
  return { startInside, endInside };
}

function snapRuns(keep: Set<number>, lines: string[], scan: LineScan): void {
  let runStart = -1;
  for (let i = 0; i <= lines.length; i++) {
    const kept = i < lines.length && keep.has(i);
    if (kept && runStart === -1) runStart = i;
    if (!kept && runStart !== -1) {
      let a = runStart;
      let b = i - 1;
      while (a > 0 && scan.startInside[a]) a--;
      while (b < lines.length - 1 && scan.endInside[b]) b++;
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
  if (lines.length < 60) return null;

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
  if (hits === 0) return null;

  snapRuns(keep, lines, scanLiterals(lines));
  if (keep.size >= lines.length * 0.8) return null;

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

function compactStackTraces(text: string): string {
  const lines = text.split("\n");
  const STACK_FRAME_RE = /^\s*(?:at\s+|File\s+"[^"]+",\s+line\s+\d+|[a-zA-Z0-9_$.]+\([a-zA-Z0-9_$.:]+\)|\d+:\s*0x[0-9a-fA-F]+\s*-)/;

  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (STACK_FRAME_RE.test(lines[i])) {
      let j = i;
      while (j < lines.length && STACK_FRAME_RE.test(lines[j])) {
        j++;
      }
      const count = j - i;
      if (count >= 6) {
        out.push(lines[i], lines[i + 1], lines[i + 2]);
        const omitted = count - 4;
        const indent = lines[i].match(/^\s*/)?.[0] ?? "    ";
        out.push(`${indent}… [thrift: ${omitted} stack trace frames omitted]`);
        out.push(lines[j - 1]);
      } else {
        for (let k = i; k < j; k++) out.push(lines[k]);
      }
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

function compactGitDiffHunks(text: string): string {
  if (!text.includes("diff --git") && !text.includes("@@ -")) return text;

  const lines = text.split("\n");
  const out: string[] = [];
  let inDiff = false;
  let contextRun: string[] = [];

  const flushContext = () => {
    if (contextRun.length === 0) return;
    if (contextRun.length >= 10) {
      out.push(...contextRun.slice(0, 3));
      const omitted = contextRun.length - 6;
      out.push(`… [thrift: ${omitted} unchanged git diff context lines omitted]`);
      out.push(...contextRun.slice(-3));
    } else {
      out.push(...contextRun);
    }
    contextRun = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git") || line.startsWith("@@ -")) {
      inDiff = true;
      flushContext();
      out.push(line);
    } else if (inDiff) {
      if (line.startsWith("+") || line.startsWith("-")) {
        flushContext();
        out.push(line);
      } else if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) {
        flushContext();
        out.push(line);
      } else {
        contextRun.push(line);
      }
    } else {
      out.push(line);
    }
  }
  flushContext();
  return out.join("\n");
}

function compactSvgBlobs(text: string): string {
  if (!text.includes("<svg") && !text.includes('d="M')) return text;
  return text.replace(/\bd="M[A-Za-z0-9\s,.-]{80,}"/g, (m) => `d="[thrift: ${m.length}-char SVG path omitted]"`);
}

function normalizeLogTimestamps(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 4) return text;

  // Regex matching ISO / standard log timestamps at start of line
  const TS_PREFIX_RE = /^(\[\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*/;
  
  // Check if at least 3 adjacent lines have the same log message modulo timestamp
  const stripped = lines.map(l => l.replace(TS_PREFIX_RE, "[TIMESTAMP] "));
  let foundRepeat = false;
  for (let i = 0; i < lines.length - 2; i++) {
    if (stripped[i].startsWith("[TIMESTAMP]") && stripped[i] === stripped[i + 1] && stripped[i] === stripped[i + 2]) {
      foundRepeat = true;
      break;
    }
  }

  if (!foundRepeat) return text;
  return stripped.join("\n");
}

function strip(text: string): string {
  const baseStripped = compactSvgBlobs(text)
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(
      /(?<![A-Za-z0-9+/._-])[A-Za-z0-9+/]{200,}={0,2}(?![A-Za-z0-9+/._-])/g,
      (m) => `[thrift: ${m.length}-char base64 omitted]`
    )
    .replace(/"integrity":\s*"sha\d+-[A-Za-z0-9+/=]+"/g, '"integrity": "[thrift: omitted]"')
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+$/gm, "");

  const stackCompacted = compactStackTraces(baseStripped);
  const diffCompacted = compactGitDiffHunks(stackCompacted);
  const normalizedLogs = normalizeLogTimestamps(diffCompacted);

  const cls = classify(normalizedLogs);
  const processedLines = cls.lines.map((line) => {
    if (line.kind === "soft") {
      return filterProseNoise(line.text);
    }
    return line.text;
  });
  return collapseRepeats(processedLines.join("\n"));
}

function collapseRepeats(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let run = 1;
    while (i + run < lines.length && lines[i + run] === lines[i]) run++;
    out.push(lines[i]);
    if (run >= 3) out.push(`… [thrift: previous line repeated ${run - 1} more times]`);
    else for (let k = 1; k < run; k++) out.push(lines[i]);
    i += run;
  }
  return out.join("\n");
}

function cap(text: string, budgetTokens: number): string {
  const est = estimateTokens(text);
  if (est.tokens <= budgetTokens) return text;
  const ratio = budgetTokens / est.tokens;
  const keepChars = Math.floor(text.length * ratio * 0.94);
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
  hardProtected: boolean;
}

function capRespectingHard(text: string, budgetTokens: number, cls: Classification): CapOutcome {
  const est = estimateTokens(text);
  if (est.tokens <= budgetTokens) return { text, hardProtected: false };

  if (cls.hardTokens === 0 || cls.softTokens === 0) {
    return { text: cap(text, budgetTokens), hardProtected: false };
  }

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
  const cls = classify(text);
  const applied: Mechanism[] = [];
  let dedupeExpired = false;
  let hardProtected = false;

  if (enable.dedupe && options.sourceId) {
    const prior = ledger.check(options.sourceId, text);
    if (prior) {
      const ageCalls = ledger.callCount - prior.atCall;
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
      dedupeExpired = true;
      ledger.rebaseline(options.sourceId, estimateTokens(text).tokens);
    }
  }

  let working = text;

  if (enable.slice && options.query) {
    const sliced = slice(working, options.query, budgetTokens);
    if (sliced && estimateTokens(sliced).tokens < estimateTokens(working).tokens) {
      working = sliced;
      applied.push("slice");
    }
  }

  if (enable.strip) {
    const stripped = strip(working);
    if (estimateTokens(stripped).tokens < estimateTokens(working).tokens) {
      working = stripped;
      applied.push("strip");
    }
  }

  if (enable.cap) {
    const currentCls = classify(working);
    const outcome = capRespectingHard(working, budgetTokens, currentCls);
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
