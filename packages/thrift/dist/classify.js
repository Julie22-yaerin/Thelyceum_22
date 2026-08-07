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
import { estimateTokens } from "./tokens.js";
// ── Per-line detectors ──────────────────────────────────────────────────────
const FENCE_RE = /^\s*(```|~~~)/;
/** A JSON structural line: an object/array opener, closer, or bracket-only line. */
const JSON_BRACKET_RE = /^\s*[{}\[\]]/;
/** `"name": value` — a JSON key/value line. */
const JSON_KEY_RE = /^\s*"\s*[\w$.\- ]+\s*":/;
/** `name: value` — YAML/config key. `Note: read this` is over-protected; that is the safe direction. */
const YAML_KEY_RE = /^\s*[-*]?\s*[\w][\w.\- ]*:\s*\S/;
/** `KEY=value` — env-style config. */
const ENV_RE = /^\s*[A-Z][A-Z0-9_]{1,63}=/;
/** Code smells: keywords, =>, assignments, or a line ending in a structural char. */
const CODE_SIGNAL_RE = /\b(function|const|let|var|import|export|class|interface|type|enum|struct|impl|fn|def|async|await|new|throw|try|catch|finally)\b|=>|^\s*return\b|[{}\[\]();]$|\b[\w$]+\s*=\s*(?!=)/;
/** Currency values and limit/budget words next to digits. */
const FINANCIAL_RE = /(\$|€|£|¥)\s?\d[\d,.]*|\b(USD|VND|EUR|GBP|JPY|KRW|CNY|SGD|AUD|CAD)\b\s?\d[\d,.]*|\d[\d,.]*\s?\b(USD|VND|EUR|GBP|JPY|KRW|CNY|SGD|AUD|CAD)\b|\b(limit|budget|threshold|balance|amount|max|min|cap)\b[^\n]{0,14}\d|\d[^\n]{0,14}\b(limit|budget|threshold|balance|amount|max|min|cap)\b/i;
/** Credentials and secrets — the exact things a compressed prompt must never corrupt. */
const CREDENTIAL_RE = /(api[_-]?key|secret|password|passwd|token|bearer|authorization|x-api-key|access[_-]?key|private[_-]?key|BEGIN [A-Z0-9 ]*PRIVATE KEY|arn:[a-z0-9:]+)/i;
/** URLs, emails, and source paths. */
const URL_RE = /https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|(?:\/|\.\.\/)[\w@./-]*(?:\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|json|yml|yaml|md|html|css|sh))[\w@./-]*|\b(?:src|lib|test|packages|node_modules)\/[\w@./-]+/;
/** Identifiers: snake_case, multi-hump camelCase, PascalCase. Rare in prose. */
const IDENT_RE = /[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+|\b[a-z]+(?:[A-Z][a-z0-9]+){2,}\b|\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/;
/** Long hex hashes, semantic versions, lockfile integrity fields. */
const HASH_RE = /\b[0-9a-f]{40,}\b|\bv\d+\.\d+\.\d+\b|"integrity":/;
/** Markdown table row. */
const TABLE_RE = /^\s*\|.*\|\s*$/;
/**
 * True when a single line carries an immutable fact (or might).
 *
 * A pure per-line check — structure (fences, brace depth) is handled by
 * `classify`, which also marks structure-inside lines HARD.
 */
export function isHardLine(line) {
    const t = line.trim();
    if (!t)
        return false;
    return (JSON_BRACKET_RE.test(t) ||
        JSON_KEY_RE.test(t) ||
        YAML_KEY_RE.test(t) ||
        ENV_RE.test(t) ||
        CODE_SIGNAL_RE.test(t) ||
        FINANCIAL_RE.test(t) ||
        CREDENTIAL_RE.test(t) ||
        URL_RE.test(t) ||
        IDENT_RE.test(t) ||
        HASH_RE.test(t) ||
        TABLE_RE.test(t));
}
// ── The pass ────────────────────────────────────────────────────────────────
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
export function classify(text) {
    const rawLines = text.split("\n");
    const lines = [];
    const structuredRuns = [];
    let fence = null;
    let braceDepth = 0;
    let runStart = -1;
    let runKind = null;
    const closeRun = (end) => {
        if (runStart >= 0 && runKind !== null) {
            structuredRuns.push({ start: runStart, end, kind: runKind });
            runStart = -1;
            runKind = null;
        }
    };
    for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        const t = raw.trim();
        const fenceLine = FENCE_RE.test(t);
        let kind;
        let inStructure = false;
        if (fence !== null) {
            // Inside a fenced block — everything is hard, including the closing fence.
            inStructure = true;
            kind = "hard";
            if (fenceLine && t.replace(FENCE_RE, "").trim() === "") {
                fence = null;
                closeRun(i);
            }
        }
        else if (fenceLine) {
            // Opening fence — the run starts HERE, and this line is part of it.
            fence = t.slice(0, 3);
            inStructure = true;
            kind = "hard";
            runStart = i;
            runKind = "fence";
        }
        else {
            const perLine = t ? (isHardLine(raw) ? "hard" : "soft") : "blank";
            const opens = (raw.match(/\{/g) || []).length;
            const closes = (raw.match(/\}/g) || []).length;
            const wasDeep = braceDepth > 0;
            const before = braceDepth;
            braceDepth += opens - closes;
            if (before === 0 && opens > closes) {
                runStart = i;
                runKind = "brace";
            }
            if (before > 0 && braceDepth <= 0) {
                closeRun(i);
                if (braceDepth < 0)
                    braceDepth = 0;
            }
            kind = wasDeep || perLine === "hard" ? "hard" : perLine;
            inStructure = wasDeep;
        }
        lines.push({ index: i, text: raw, kind, inStructure });
    }
    // Unterminated structure — still protects to the end.
    closeRun(rawLines.length - 1);
    let hardChars = 0;
    let softChars = 0;
    let hardLines = 0;
    let softLines = 0;
    let blankLines = 0;
    const hardParts = [];
    const softParts = [];
    for (const l of lines) {
        if (l.kind === "hard") {
            hardLines++;
            hardChars += l.text.length;
            hardParts.push(l.text);
        }
        else if (l.kind === "soft") {
            softLines++;
            softChars += l.text.length;
            softParts.push(l.text);
        }
        else {
            blankLines++;
            softParts.push(l.text);
        }
    }
    const hardTokens = estimateTokens(hardParts.join("\n")).tokens;
    const softTokens = estimateTokens(softParts.join("\n")).tokens;
    const total = hardTokens + softTokens;
    return {
        lines,
        hardLines,
        softLines,
        blankLines,
        hardChars,
        softChars,
        hardTokens,
        softTokens,
        hardFraction: total > 0 ? hardTokens / total : 0,
        structuredRuns,
    };
}
//# sourceMappingURL=classify.js.map