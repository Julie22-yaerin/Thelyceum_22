/**
 * Agent Framework SDK Tools & Adapters for Savier.
 * Exposes standard helper tools for Vercel AI SDK, Mastra, LangChain, and custom AI agent loops.
 */
/**
 * Creates a search capabilities tool that queries both ToolCatalog and SkillCatalog.
 * Allows agents to progressively search for tools and skills rather than loading them up front.
 */
export function searchCapabilitiesTool(toolCatalog, skillCatalog) {
    return {
        id: "search_capabilities",
        name: "search_capabilities",
        description: "Search for available tools and skills matching a task or request. Use this to discover capabilities dynamically.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Keyword or semantic description of what action or skill you need.",
                },
                limit: {
                    type: "number",
                    description: "Max number of tools and skills to return (default 5).",
                },
            },
            required: ["query"],
        },
        execute: async ({ query, limit = 5 }) => {
            const toolResults = toolCatalog.search(query, { limit });
            const skillResults = skillCatalog.search(query, { limit });
            return {
                query,
                tools: toolResults,
                skills: skillResults,
            };
        },
    };
}
/**
 * Creates an invoke tool helper that executes a registered tool from the ToolCatalog
 * and compresses its result automatically using Savier's token economy engine.
 */
export function invokeToolTool(toolCatalog, defaultOptions = {}) {
    return {
        id: "invoke_tool",
        name: "invoke_tool",
        description: "Execute a tool registered in the catalog by tool ID, with automatic token compression.",
        parameters: {
            type: "object",
            properties: {
                tool_id: {
                    type: "string",
                    description: "The ID of the tool to execute.",
                },
                args: {
                    type: "object",
                    description: "Arguments to pass to the tool function.",
                },
                budget_tokens: {
                    type: "number",
                    description: "Optional token budget cap for compressed tool output.",
                },
            },
            required: ["tool_id"],
        },
        execute: async ({ tool_id, args = {}, budget_tokens, }) => {
            const options = {
                ...defaultOptions,
                ...(budget_tokens ? { budgetTokens: budget_tokens } : {}),
            };
            return await toolCatalog.invoke(tool_id, args, options);
        },
    };
}
/**
 * Creates a get skill content tool that retrieves the full playbook instructions of a skill.
 */
export function getSkillContentTool(skillCatalog) {
    return {
        id: "get_skill_content",
        name: "get_skill_content",
        description: "Load the detailed playbook/body instructions for a specific skill.",
        parameters: {
            type: "object",
            properties: {
                skill_id: {
                    type: "string",
                    description: "The ID of the skill to fetch.",
                },
            },
            required: ["skill_id"],
        },
        execute: async ({ skill_id }) => {
            return skillCatalog.getSkillContent(skill_id);
        },
    };
}
//# sourceMappingURL=sdk.js.map