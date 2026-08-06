/**
 * Okapi BM25 + Field-Weighted Hybrid Search Engine for Savier.
 * Provides sub-millisecond keyword and field-weighted capability retrieval.
 */

export interface BM25Document {
  id: string;
  fields: Record<string, string | string[] | undefined>;
}

export interface BM25Options {
  k1?: number;
  b?: number;
  fieldWeights?: Record<string, number>;
}

export interface SearchResult<T extends BM25Document = BM25Document> {
  document: T;
  score: number;
  matchedTerms: string[];
}

export class BM25Engine<T extends BM25Document = BM25Document> {
  private documents: T[] = [];
  private k1: number;
  private b: number;
  private fieldWeights: Record<string, number>;

  // Index structures
  private docTokens: Map<string, Map<string, number>> = new Map(); // docId -> term -> termFreq
  private docLengths: Map<string, number> = new Map(); // docId -> length
  private avgDocLength: number = 0;
  private df: Map<string, number> = new Map(); // term -> document frequency

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.fieldWeights = options.fieldWeights ?? {
      name: 3.5,
      id: 3.0,
      tags: 2.5,
      description: 2.0,
      schema: 1.5,
      body: 1.0,
    };
  }

  /**
   * Tokenize text into normalized terms, splitting camelCase, snake_case, etc.
   */
  public static tokenize(text: string): string[] {
    if (!text) return [];
    // Split camelCase -> camel Case
    const splitCamel = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    // Replace non-alphanumeric with space & lowercase
    const cleaned = splitCamel.toLowerCase().replace(/[^a-z0-9_\-\.\/]/g, " ");
    return cleaned
      .split(/[\s_\-\.\/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1);
  }

  public addDocument(doc: T): void {
    this.documents.push(doc);
    this.reindex();
  }

  public addDocuments(docs: T[]): void {
    this.documents.push(...docs);
    this.reindex();
  }

  public clear(): void {
    this.documents = [];
    this.docTokens.clear();
    this.docLengths.clear();
    this.df.clear();
    this.avgDocLength = 0;
  }

  public removeDocument(id: string): void {
    this.documents = this.documents.filter((d) => d.id !== id);
    this.reindex();
  }

  private reindex(): void {
    this.docTokens.clear();
    this.docLengths.clear();
    this.df.clear();

    let totalLength = 0;
    const N = this.documents.length;

    for (const doc of this.documents) {
      const termFreqs = new Map<string, number>();
      let docLen = 0;

      for (const [field, val] of Object.entries(doc.fields)) {
        if (!val) continue;
        const weight = this.fieldWeights[field] ?? 1.0;
        const valStr = Array.isArray(val) ? val.join(" ") : String(val);
        const tokens = BM25Engine.tokenize(valStr);

        for (const token of tokens) {
          const current = termFreqs.get(token) ?? 0;
          termFreqs.set(token, current + weight);
          docLen += weight;
        }
      }

      this.docTokens.set(doc.id, termFreqs);
      this.docLengths.set(doc.id, docLen);
      totalLength += docLen;

      // Unique terms for document frequency
      for (const term of termFreqs.keys()) {
        const count = this.df.get(term) ?? 0;
        this.df.set(term, count + 1);
      }
    }

    this.avgDocLength = N > 0 ? totalLength / N : 0;
  }

  /**
   * Search indexed documents using Okapi BM25 algorithm with exact/prefix bonus.
   */
  public search(query: string, topK: number = 10, minScore: number = 0.01): SearchResult<T>[] {
    const queryTokens = BM25Engine.tokenize(query);
    if (queryTokens.length === 0 || this.documents.length === 0) {
      return [];
    }

    const N = this.documents.length;
    const results: SearchResult<T>[] = [];

    for (const doc of this.documents) {
      const termFreqs = this.docTokens.get(doc.id);
      if (!termFreqs) continue;

      const docLen = this.docLengths.get(doc.id) ?? this.avgDocLength;
      let score = 0;
      const matchedTerms: string[] = [];

      for (const qTerm of queryTokens) {
        // Calculate IDF for qTerm
        const n_q = this.df.get(qTerm) ?? 0;
        if (n_q === 0) {
          // Check prefix or partial match fallback
          let partialMatchWeight = 0;
          for (const [docTerm, tf] of termFreqs.entries()) {
            if (docTerm.includes(qTerm) || qTerm.includes(docTerm)) {
              partialMatchWeight += tf * 0.5;
            }
          }
          if (partialMatchWeight > 0) {
            score += partialMatchWeight * 0.2;
            matchedTerms.push(qTerm);
          }
          continue;
        }

        const idf = Math.log((N - n_q + 0.5) / (n_q + 0.5) + 1.0);
        const tf = termFreqs.get(qTerm) ?? 0;

        if (tf > 0) {
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLength || 1)));
          score += idf * (numerator / denominator);
          matchedTerms.push(qTerm);
        }
      }

      // Exact phrase / exact ID match boost
      const lowerQuery = query.toLowerCase().trim();
      const docName = String(doc.fields.name ?? "").toLowerCase();
      const docId = doc.id.toLowerCase();
      if (docName === lowerQuery || docId === lowerQuery) {
        score += 10.0;
      } else if (docName.includes(lowerQuery) || docId.includes(lowerQuery)) {
        score += 3.0;
      }

      if (score >= minScore) {
        results.push({
          document: doc,
          score: Number(score.toFixed(4)),
          matchedTerms: Array.from(new Set(matchedTerms)),
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
