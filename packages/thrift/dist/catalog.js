/**
 * Tool and Skill Progressive Disclosure Catalogs for Savier.
 * Allows indexing tools and skills and dynamic retrieval to eliminate token overload up front,
 * while automatically compressing tool execution outputs on invocation.
 */
import { BM25Engine } from "./bm25.js";
import { compress, SeenLedger } from "./compress.js";
import { record } from "./ledger.js";
export class ToolCatalog {
    tools = new Map();
    bm25 = new BM25Engine({
        fieldWeights: {
            name: 3.5,
            id: 3.0,
            tags: 2.5,
            description: 2.0,
            schema: 1.5,
        },
    });
    seenLedger;
    constructor(seenLedger) {
        this.seenLedger = seenLedger ?? new SeenLedger();
    }
    getLedger() {
        return this.seenLedger;
    }
    register(tool) {
        this.tools.set(tool.id, tool);
        const schemaStr = tool.inputSchema ? JSON.stringify(tool.inputSchema) : "";
        const doc = {
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
    get(id) {
        return this.tools.get(id);
    }
    list() {
        return Array.from(this.tools.values());
    }
    search(query, options = {}) {
        const limit = options.limit ?? 10;
        const minScore = options.minScore ?? 0.01;
        const results = this.bm25.search(query, limit * 2, minScore);
        let filtered = results;
        if (options.tags && options.tags.length > 0) {
            const requiredTags = new Set(options.tags.map((t) => t.toLowerCase()));
            filtered = filtered.filter((r) => r.document.tool.tags?.some((tag) => requiredTags.has(tag.toLowerCase())));
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
    async invoke(id, args = {}, options = {}) {
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
        await record(compRes, `tool:${id}`).catch(() => { });
        return {
            toolId: id,
            rawOutput,
            compressedText: `${compRes.text}\n\n[savier: ${compRes.note}]`,
            compressionResult: compRes,
        };
    }
}
export class SkillCatalog {
    skills = new Map();
    bm25 = new BM25Engine({
        fieldWeights: {
            name: 3.5,
            id: 3.0,
            tags: 2.5,
            description: 2.0,
            body: 1.2,
        },
    });
    register(skill) {
        this.skills.set(skill.id, skill);
        const doc = {
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
    get(id) {
        return this.skills.get(id);
    }
    list() {
        return Array.from(this.skills.values());
    }
    search(query, options = {}) {
        const limit = options.limit ?? 10;
        const minScore = options.minScore ?? 0.01;
        const results = this.bm25.search(query, limit * 2, minScore);
        let filtered = results;
        if (options.tags && options.tags.length > 0) {
            const requiredTags = new Set(options.tags.map((t) => t.toLowerCase()));
            filtered = filtered.filter((r) => r.document.skill.tags?.some((tag) => requiredTags.has(tag.toLowerCase())));
        }
        return filtered.slice(0, limit).map((r) => ({
            skill: r.document.skill,
            score: r.score,
            matchedTerms: r.matchedTerms,
        }));
    }
    getSkillContent(id) {
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
//# sourceMappingURL=catalog.js.map