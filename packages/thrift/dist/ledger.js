/**
 * The savings ledger.
 *
 * Every compression writes one NDJSON line to ~/.thrift/ledger.log. That file
 * is the whole basis for anything thrift claims about what it saved — the same
 * discipline the brake applies to its SLA. A number nobody can check is a
 * number nobody should believe, including us.
 *
 * ── What is recorded, and why each field is here ────────────────────────────
 * `lossless` is the field that matters most. Deduplication returns a pointer
 * to content the model already has, so nothing is lost. Truncation drops text.
 * Both reduce tokens; only one of them is free. Reporting a single blended
 * percentage would let a 90% "saving" that was almost entirely truncation
 * masquerade as compression, so the ledger keeps them apart and `summarise`
 * refuses to merge them.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
export const THRIFT_HOME = process.env.THRIFT_HOME ?? join(homedir(), ".thrift");
export const DEFAULT_LEDGER_PATH = join(THRIFT_HOME, "ledger.log");
/** Truncation and slicing drop text; dedupe and strip do not. */
export function isLossless(applied) {
    return !applied.includes("cap") && !applied.includes("slice");
}
function ledgerPath(override) {
    return override ? resolve(override) : DEFAULT_LEDGER_PATH;
}
export async function record(result, sourceId, pathOverride) {
    const entry = {
        at: Date.now(),
        sourceId,
        applied: result.applied,
        beforeTokens: result.before.tokens,
        afterTokens: result.after.tokens,
        saved: result.saved,
        lossless: isLossless(result.applied),
        method: result.before.method,
    };
    const path = ledgerPath(pathOverride);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
}
/**
 * Read back the last `limit` entries and total them.
 *
 * Reads backwards in fixed-size chunks so a ledger that has been accumulating
 * for months does not have to be loaded into memory to answer "what did you
 * save today" — the same bound the brake's audit log uses, for the same
 * reason.
 */
export async function summarise(limit = 5000, pathOverride) {
    const path = ledgerPath(pathOverride);
    const empty = {
        calls: 0, beforeTokens: 0, afterTokens: 0, savedTokens: 0, savedFraction: 0,
        losslessSavedTokens: 0, losslessFraction: 0, lossySavedTokens: 0,
        byMechanism: {}, note: "No compressions recorded yet.",
    };
    if (!existsSync(path))
        return empty;
    const CHUNK = 64 * 1024;
    const handle = await fs.open(path, "r");
    const lines = [];
    try {
        const { size } = await handle.stat();
        if (size === 0)
            return empty;
        let position = size;
        let carry = "";
        while (position > 0 && lines.length <= limit) {
            const readSize = Math.min(CHUNK, position);
            position -= readSize;
            const buf = Buffer.alloc(readSize);
            await handle.read(buf, 0, readSize, position);
            const parts = (buf.toString("utf-8") + carry).split("\n");
            carry = position > 0 ? parts.shift() : "";
            for (let i = parts.length - 1; i >= 0; i--)
                if (parts[i])
                    lines.push(parts[i]);
        }
        if (carry)
            lines.push(carry);
    }
    finally {
        await handle.close();
    }
    const entries = [];
    for (const line of lines.slice(0, limit)) {
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            // A corrupt line is skipped rather than throwing. A half-written entry
            // from a killed process must not make the whole report unreadable.
        }
    }
    if (entries.length === 0)
        return empty;
    let beforeTokens = 0, afterTokens = 0, lossless = 0, lossy = 0;
    const byMechanism = {};
    for (const e of entries) {
        beforeTokens += e.beforeTokens;
        afterTokens += e.afterTokens;
        if (e.lossless)
            lossless += e.saved;
        else
            lossy += e.saved;
        for (const m of e.applied)
            byMechanism[m] = (byMechanism[m] ?? 0) + 1;
    }
    const savedTokens = beforeTokens - afterTokens;
    return {
        calls: entries.length,
        beforeTokens,
        afterTokens,
        savedTokens,
        savedFraction: beforeTokens > 0 ? savedTokens / beforeTokens : 0,
        losslessSavedTokens: lossless,
        losslessFraction: beforeTokens > 0 ? lossless / beforeTokens : 0,
        lossySavedTokens: lossy,
        byMechanism,
        note: lossy > lossless
            ? "Most of this saving came from TRUNCATION, not deduplication — the model was told, but it saw less than the full text. Raise --budget if answers look incomplete."
            : "Most of this saving was lossless: the model already had the content, or the removed bytes carried no meaning.",
    };
}
//# sourceMappingURL=ledger.js.map