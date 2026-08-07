/**
 * The compressor.
 */
import { type TokenCount } from "./tokens.js";
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
export declare const DEFAULT_MAX_DEDUPE_AGE_CALLS = 20;
export declare const DEFAULT_MAX_DEDUPE_AGE_TOKENS = 40000;
interface SeenEntry {
    hash: string;
    atCall: number;
    emittedAt: number;
    tokens: number;
}
export declare class SeenLedger {
    private seen;
    private calls;
    private emitted;
    get callCount(): number;
    get emittedTokens(): number;
    reset(): void;
    size(): number;
    recordEmission(tokens: number): void;
    check(sourceId: string, text: string): SeenEntry | null;
    rebaseline(sourceId: string, tokens: number): void;
}
export declare function compress(text: string, ledger: SeenLedger, options?: CompressOptions): CompressResult;
export {};
