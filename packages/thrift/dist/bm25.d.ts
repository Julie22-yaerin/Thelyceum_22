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
export declare class BM25Engine<T extends BM25Document = BM25Document> {
    private documents;
    private k1;
    private b;
    private fieldWeights;
    private docTokens;
    private docLengths;
    private avgDocLength;
    private df;
    constructor(options?: BM25Options);
    /**
     * Tokenize text into normalized terms, splitting camelCase, snake_case, etc.
     */
    static tokenize(text: string): string[];
    addDocument(doc: T): void;
    addDocuments(docs: T[]): void;
    clear(): void;
    removeDocument(id: string): void;
    private reindex;
    /**
     * Search indexed documents using Okapi BM25 algorithm with exact/prefix bonus.
     */
    search(query: string, topK?: number, minScore?: number): SearchResult<T>[];
}
