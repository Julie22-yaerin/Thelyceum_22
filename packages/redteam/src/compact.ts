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

// Unicode-aware hesitation regex using \p{L} lookbehind/ahead
const HESITATION_REGEX = /(?:,\s*)?(?<=^|[^\p{L}\p{N}])(?:uh+m*|um+|er+|ah+|hmm+|err+|you know|sort of|kind of|ừm+|ờ+|à|kiểu như là|kiểu như|kiểu là|nói chung là|tóm lại là|thì là)(?=$|[^\p{L}\p{N}])(?:\s*,)?/gui;

const FAST_CHECK_REGEX = /(?<=^|[^\p{L}\p{N}])(?:uh+m*|um+|er+|ah+|hmm+|err+|you know|sort of|kind of|ừm+|ờ+|à|kiểu như là|kiểu như|kiểu là|thì là)(?=$|[^\p{L}\p{N}])/ui;

const DUPLICATE_CHECK_REGEX = /(^|[\s,.:;!?])([^\s,.:;!?]+)[\s,]+\2(?=$|[\s,.:;!?])/i;

const VIETNAMESE_REDUPLICATIVE_EXCEPTIONS = new Set([
  "ngày", "đêm", "nhà", "người", "năm", "tháng", "giờ", "lần", "lớp", "hàng", "chiều", "sáng"
]);

export function needsCompacting(text: string): boolean {
  if (!text || text.length < 2) return false;
  return FAST_CHECK_REGEX.test(text) || DUPLICATE_CHECK_REGEX.test(text);
}

export function compactContext(text: string, options: CompactOptions = {}): CompactResult {
  if (!text || text.trim() === "" || !needsCompacting(text)) {
    return {
      originalText: text,
      compactedText: text,
      removedTokensCount: 0,
      removedFillers: [],
      removedDuplicates: [],
    };
  }

  const preserveRedup = options.preserveVietnameseReduplication ?? true;
  let currentText = text;
  const removedFillers: string[] = [];
  const removedDuplicates: string[] = [];

  // Step 1: Remove Hesitation / Filler Words & Phrases (Unicode aware)
  currentText = currentText.replace(HESITATION_REGEX, (match) => {
    const clean = match.trim().replace(/^,|,$/g, "").trim();
    if (clean) removedFillers.push(clean);
    return " ";
  });

  // Step 2: Remove Immediate Duplicate Words (Multilingual)
  const duplicateRegex = /(^|[\s,.:;!?])([^\s,.:;!?]+)([\s,]+)\2(?=$|[\s,.:;!?])/gi;

  currentText = currentText.replace(duplicateRegex, (fullMatch, prefix, word) => {
    const lowerWord = word.toLowerCase();
    if (preserveRedup && VIETNAMESE_REDUPLICATIVE_EXCEPTIONS.has(lowerWord)) {
      return fullMatch;
    }
    removedDuplicates.push(`${word} ${word}`);
    return `${prefix}${word}`;
  });

  // Step 3: Punctuation and Whitespace Cleanup
  let compactedText = currentText
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s+,\s*/g, " ")              // orphan commas -> space
    .replace(/\s+\.\s*/g, ". ")            // space before dot -> dot space
    .replace(/[ \t]+/g, " ")               // collapse spaces
    .replace(/\s+([.,!?;:])/g, "$1")       // no space right before punctuation
    .replace(/,\s*\./g, ".")               // comma before period -> period
    .replace(/ \n/g, "\n")
    .replace(/\n /g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const totalRemoved = removedFillers.length + removedDuplicates.length;

  return {
    originalText: text,
    compactedText,
    removedTokensCount: totalRemoved,
    removedFillers,
    removedDuplicates,
  };
}
