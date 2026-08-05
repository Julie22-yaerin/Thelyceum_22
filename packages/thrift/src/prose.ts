/**
 * Remove English and Vietnamese hesitation/filler words and collapse duplicate words in prose.
 * Operates on soft text lines, preserving punctuation and code structure.
 */

export function filterProseNoise(text: string): string {
  if (!text.trim()) return text;

  const splitWords = text.split(/\s+/);
  const filteredWords: string[] = [];
  const hesitationSet = new Set(["um", "uh", "er", "ah", "eh", "uhm", "ờ", "ừ", "à", "dạ", "vâng"]);
  let prevClean = "";

  for (const word of splitWords) {
    if (!word) continue;
    if (word.length > 30) {
      filteredWords.push(word);
      prevClean = "";
      continue;
    }
    const clean = word.toLowerCase().replace(/[\p{P}\p{S}]/gu, "");
    if (clean === "") {
      filteredWords.push(word);
      continue;
    }
    if (hesitationSet.has(clean)) {
      continue;
    }
    if (clean === prevClean) {
      continue;
    }
    filteredWords.push(word);
    prevClean = clean;
  }

  const leading = text.match(/^\s*/)?.[0] ?? "";
  const trailing = text.match(/\s*$/)?.[0] ?? "";
  return leading + filteredWords.join(" ") + trailing;
}
