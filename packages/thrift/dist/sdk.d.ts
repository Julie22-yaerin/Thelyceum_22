/**
 * Agent Framework SDK Tools & Adapters for Savier.
 * Exposes standard helper tools for Vercel AI SDK, Mastra, LangChain, and custom AI agent loops.
 */
import { ToolCatalog, SkillCatalog, type CapabilitySearchResult, type ToolInvokeResult } from "./catalog.js";
import type { CompressOptions } from "./compress.js";
/**
 * Creates a search capabilities tool that queries both ToolCatalog and SkillCatalog.
 * Allows agents to progressively search for tools and skills rather than loading them up front.
 */
export declare function searchCapabilitiesTool(toolCatalog: ToolCatalog, skillCatalog: SkillCatalog): {
    id: string;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            query: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: ({ query, limit }: {
        query: string;
        limit?: number;
    }) => Promise<CapabilitySearchResult>;
};
/**
 * Creates an invoke tool helper that executes a registered tool from the ToolCatalog
 * and compresses its result automatically using Savier's token economy engine.
 */
export declare function invokeToolTool(toolCatalog: ToolCatalog, defaultOptions?: CompressOptions): {
    id: string;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            tool_id: {
                type: string;
                description: string;
            };
            args: {
                type: string;
                description: string;
            };
            budget_tokens: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: ({ tool_id, args, budget_tokens, }: {
        tool_id: string;
        args?: Record<string, any>;
        budget_tokens?: number;
    }) => Promise<ToolInvokeResult>;
};
/**
 * Creates a get skill content tool that retrieves the full playbook instructions of a skill.
 */
export declare function getSkillContentTool(skillCatalog: SkillCatalog): {
    id: string;
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            skill_id: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
    execute: ({ skill_id }: {
        skill_id: string;
    }) => Promise<{
        id: string;
        name: string;
        description: string;
        body: string;
        tools?: string[];
    }>;
};
