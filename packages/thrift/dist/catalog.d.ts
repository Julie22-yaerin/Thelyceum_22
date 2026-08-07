/**
 * Tool and Skill Progressive Disclosure Catalogs for Savier.
 * Allows indexing tools and skills and dynamic retrieval to eliminate token overload up front,
 * while automatically compressing tool execution outputs on invocation.
 */
import { SeenLedger, type CompressOptions, type CompressResult } from "./compress.js";
export interface ToolDefinition {
    id: string;
    name: string;
    description: string;
    inputSchema?: Record<string, any>;
    outputSchema?: Record<string, any>;
    execute?: (args: any) => Promise<any> | any;
    tags?: string[];
    metadata?: Record<string, any>;
}
export interface SkillDefinition {
    id: string;
    name: string;
    description: string;
    tools?: string[];
    body: string;
    tags?: string[];
    metadata?: Record<string, any>;
}
export interface CatalogSearchOptions {
    limit?: number;
    minScore?: number;
    tags?: string[];
}
export interface ToolSearchResult {
    tool: ToolDefinition;
    score: number;
    matchedTerms: string[];
}
export interface SkillSearchResult {
    skill: SkillDefinition;
    score: number;
    matchedTerms: string[];
}
export interface CapabilitySearchResult {
    tools: ToolSearchResult[];
    skills: SkillSearchResult[];
    query: string;
}
export interface ToolInvokeResult {
    toolId: string;
    rawOutput: any;
    compressedText: string;
    compressionResult: CompressResult;
}
export declare class ToolCatalog {
    private tools;
    private bm25;
    private seenLedger;
    constructor(seenLedger?: SeenLedger);
    getLedger(): SeenLedger;
    register(tool: ToolDefinition): void;
    get(id: string): ToolDefinition | undefined;
    list(): ToolDefinition[];
    search(query: string, options?: CatalogSearchOptions): ToolSearchResult[];
    /**
     * Execute a registered tool and automatically compress its output using Savier token compression engine.
     */
    invoke(id: string, args?: any, options?: CompressOptions): Promise<ToolInvokeResult>;
}
export declare class SkillCatalog {
    private skills;
    private bm25;
    register(skill: SkillDefinition): void;
    get(id: string): SkillDefinition | undefined;
    list(): SkillDefinition[];
    search(query: string, options?: CatalogSearchOptions): SkillSearchResult[];
    getSkillContent(id: string): {
        id: string;
        name: string;
        description: string;
        body: string;
        tools?: string[];
    };
}
