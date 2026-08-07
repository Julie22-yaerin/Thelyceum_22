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
import type { CompressResult, Mechanism } from "./compress.js";
export declare const THRIFT_HOME: string;
export declare const DEFAULT_LEDGER_PATH: string;
export interface LedgerEntry {
    at: number;
    sourceId?: string;
    applied: Mechanism[];
    beforeTokens: number;
    afterTokens: number;
    saved: number;
    /** True when nothing was dropped — dedupe and strip only. */
    lossless: boolean;
    /** Always "heuristic" unless an exact count was requested. */
    method: string;
}
/** Truncation and slicing drop text; dedupe and strip do not. */
export declare function isLossless(applied: Mechanism[]): boolean;
export declare function record(result: CompressResult, sourceId?: string, pathOverride?: string): Promise<void>;
export interface Summary {
    calls: number;
    beforeTokens: number;
    afterTokens: number;
    savedTokens: number;
    savedFraction: number;
    /** Savings that cost nothing — deduplication and noise removal. */
    losslessSavedTokens: number;
    losslessFraction: number;
    /** Savings that dropped text. Announced to the model, but still a loss. */
    lossySavedTokens: number;
    byMechanism: Record<string, number>;
    /** One line an operator can act on. */
    note: string;
}
/**
 * Read back the last `limit` entries and total them.
 *
 * Reads backwards in fixed-size chunks so a ledger that has been accumulating
 * for months does not have to be loaded into memory to answer "what did you
 * save today" — the same bound the brake's audit log uses, for the same
 * reason.
 */
export declare function summarise(limit?: number, pathOverride?: string): Promise<Summary>;
