/**
 * Smart context compacting (Lọc ngữ cảnh hợp lý).
 *
 * Cleans hesitation words, fillers, and accidental duplicate words without
 * aggressive stripping that could lose critical technical context, logic, or meaning.
 *
 * Follows the Goldilocks principle: balanced, clean, and context-preserving.
 */
export interface CompactResult {
    originalText: string;
    compactedText: string;
    removedTokensCount: number;
    removedFillers: string[];
    removedDuplicates: string[];
}
export interface CompactOptions {
    /** Preserve valid Vietnamese reduplicative words (e.g., "ngày ngày", "nhà nhà"). Default: true */
    preserveVietnameseReduplication?: boolean;
}
export declare function needsCompacting(text: string): boolean;
export declare function compactContext(text: string, options?: CompactOptions): CompactResult;
//# sourceMappingURL=compact.d.ts.map