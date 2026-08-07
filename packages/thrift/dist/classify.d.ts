/**
 * classify.ts — Hard Data vs Semantic Text
 *
 * ── The iron rule this module exists to enforce ────────────────────────────
 * Immutable facts must survive byte-identical. A token saved by truncating a
 * JSON schema, a financial limit, or a code block is not a saving — it is a
 * retry the operator never sees the cause of. So before any lossy mechanism
 * fires, the payload is split into two classes:
 *
 *   HARD  — JSON/YAML/config structure, fenced and brace-balanced code,
 *           identifiers (variable/function names), financial limits and
 *           currency values, credentials and tokens, URLs and paths.
 *           These may be DEDUPED (a byte-identical pointer to content the
 *           model already has) but never truncated or semantically compressed.
 *   SOFT  — prose, explanations, small talk. The only thing strip/compress
 *           may cut.
 *
 * ── How classification works ───────────────────────────────────────────────
 * One cheap pass, line by line, with two pieces of cross-line state:
 * fence depth (``` / ~~~ blocks) and brace depth ({ … } regions). A line is
 * HARD when it sits inside such a structure OR matches any fact detector
 * (JSON key, config key, currency, credential, identifier, URL, hash, …).
 *
 * Deliberately conservative: a line that might carry a fact is HARD, because
 * over-protecting costs a few tokens while under-protecting corrupts data the
 * model will act on. When classification has to guess, it protects.
 */
export type LineKind = "hard" | "soft" | "blank";
export interface LineClass {
    /** 0-based line index. */
    index: number;
    /** The line without its trailing newline. */
    text: string;
    kind: LineKind;
    /** True when this line sits inside a fenced or brace-balanced structure. */
    inStructure: boolean;
}
export interface StructuredRun {
    /** Inclusive 0-based line range of the structure. */
    start: number;
    end: number;
    /** What opened it: a ``` fence or a { … } region. */
    kind: "fence" | "brace";
}
export interface Classification {
    lines: LineClass[];
    hardLines: number;
    softLines: number;
    blankLines: number;
    hardChars: number;
    softChars: number;
    hardTokens: number;
    softTokens: number;
    /** hardTokens / (hardTokens + softTokens); 0 when there is no hard data. */
    hardFraction: number;
    /** Fenced and brace-balanced regions, in order, merged when adjacent. */
    structuredRuns: StructuredRun[];
}
/**
 * True when a single line carries an immutable fact (or might).
 *
 * A pure per-line check — structure (fences, brace depth) is handled by
 * `classify`, which also marks structure-inside lines HARD.
 */
export declare function isHardLine(line: string): boolean;
/**
 * Classify a payload into hard (immutable, protected) and soft (compressible)
 * lines, tracking fenced and brace-balanced structures across lines.
 *
 * Fences: everything from the opening ``` to the closing ``` is HARD,
 * including the fence lines themselves. An unterminated fence (truncated
 * input) protects to the end of the payload — the safe direction.
 *
 * Braces: from the line that opens a { … } region until the line that closes
 * it, every line is HARD. Balanced braces on one line open and close within
 * the same line, so they do not create a run. A stray brace in prose extends
 * the run until the next balancing brace; that over-protects, which is the
 * direction this module is built to err in.
 */
export declare function classify(text: string): Classification;
