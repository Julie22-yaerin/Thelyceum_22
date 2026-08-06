/**
 * Tool and Skill Progressive Disclosure Catalogs for Savier.
 * Allows indexing tools and skills and dynamic retrieval to eliminate token overload up front,
 * while automatically compressing tool execution outputs on invocation.
 */

import { BM25Engine, type BM25Document } from "./bm25.js";
import { compress, SeenLedger, type CompressOptions, type CompressResult } from "./compress.js";
import { record } from "./ledger.js";

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

interface ToolDoc extends BM25Document {
  tool: ToolDefinition;
}

interface SkillDoc extends BM25Document {
  skill: SkillDefinition;
}

export class ToolCatalog {
  private tools: Map<string, ToolDefinition> = new Map();
  private bm25: BM25Engine<ToolDoc> = new BM25Engine<ToolDoc>({
    fieldWeights: {
      name: 3.5,
      id: 3.0,
      tags: 2.5,
      description: 2.0,
      schema: 1.5,
    },
  });
  private seenLedger: SeenLedger;

  constructor(seenLedger?: SeenLedger) {
    this.seenLedger = seenLedger ?? new SeenLedger();
  }

  public getLedger(): SeenLedger {
    return this.seenLedger;
  }

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
    const schemaStr = tool.inputSchema ? JSON.stringify(tool.inputSchema) : "";

    const doc: ToolDoc = {
      id: tool.id,
      fields: {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        tags: tool.tags ?? [],
        schema: schemaStr,
      },
      tool,
    };
    this.bm25.removeDocument(tool.id);
    this.bm25.addDocument(doc);
  }

  public get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  public list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public search(query: string, options: CatalogSearchOptions = {}): ToolSearchResult[] {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.01;
    const results = this.bm25.search(query, limit * 2, minScore);

    let filtered = results;
    if (options.tags && options.tags.length > 0) {
      const requiredTags = new Set(options.tags.map((t) => t.toLowerCase()));
      filtered = filtered.filter((r) =>
        r.document.tool.tags?.some((tag) => requiredTags.has(tag.toLowerCase()))
      );
    }

    return filtered.slice(0, limit).map((r) => ({
      tool: r.document.tool,
      score: r.score,
      matchedTerms: r.matchedTerms,
    }));
  }

  /**
   * Execute a registered tool and automatically compress its output using Savier token compression engine.
   */
  public async invoke(
    id: string,
    args: any = {},
    options: CompressOptions = {}
  ): Promise<ToolInvokeResult> {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool '${id}' not found in catalog.`);
    }
    if (!tool.execute) {
      throw new Error(`Tool '${id}' has no execute function registered.`);
    }

    const rawOutput = await tool.execute(args);
    const textOutput = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput, null, 2);

    const compRes = compress(textOutput, this.seenLedger, {
      sourceId: `tool:${id}`,
      ...options,
    });

    await record(compRes, `tool:${id}`).catch(() => {});

    return {
      toolId: id,
      rawOutput,
      compressedText: `${compRes.text}\n\n[savier: ${compRes.note}]`,
      compressionResult: compRes,
    };
  }
}

export class SkillCatalog {
  private skills: Map<string, SkillDefinition> = new Map();
  private bm25: BM25Engine<SkillDoc> = new BM25Engine<SkillDoc>({
    fieldWeights: {
      name: 3.5,
      id: 3.0,
      tags: 2.5,
      description: 2.0,
      body: 1.2,
    },
  });

  public register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);

    const doc: SkillDoc = {
      id: skill.id,
      fields: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tags: skill.tags ?? [],
        body: skill.body,
      },
      skill,
    };
    this.bm25.removeDocument(skill.id);
    this.bm25.addDocument(doc);
  }

  public get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  public list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  public search(query: string, options: CatalogSearchOptions = {}): SkillSearchResult[] {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.01;
    const results = this.bm25.search(query, limit * 2, minScore);

    let filtered = results;
    if (options.tags && options.tags.length > 0) {
      const requiredTags = new Set(options.tags.map((t) => t.toLowerCase()));
      filtered = filtered.filter((r) =>
        r.document.skill.tags?.some((tag) => requiredTags.has(tag.toLowerCase()))
      );
    }

    return filtered.slice(0, limit).map((r) => ({
      skill: r.document.skill,
      score: r.score,
      matchedTerms: r.matchedTerms,
    }));
  }

  public getSkillContent(id: string): { id: string; name: string; description: string; body: string; tools?: string[] } {
    const skill = this.skills.get(id);
    if (!skill) {
      throw new Error(`Skill '${id}' not found in catalog.`);
    }
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      tools: skill.tools,
    };
  }
}
