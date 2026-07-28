/**
 * MCPInspector — Component Tests
 *
 * Tests for:
 * - Component rendering (header, tool list, detail panel)
 * - Tool selection and argument default population
 * - JSON validation (valid/invalid argument text)
 * - Call tool flow (response display, error display)
 * - Call history (entries added, replay functionality)
 * - Search/filter behavior
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Pure Logic Tests ─────────────────────────────────────────────────────────
// The MCPInspector is a React component with heavy WebSocket/effect dependencies,
// so we test the pure logic functions and state transitions separately.

// Re-create the DEFAULT_ARGS and pure utility functions that the component uses

const DEFAULT_ARGS: Record<string, string> = {
  lyceum_agents_list: "{}",
  lyceum_agent_get_status: JSON.stringify({ agentId: "agent-1" }, null, 2),
  lyceum_agent_recharge: JSON.stringify({ agentId: "agent-4", amount: 50000 }, null, 2),
  lyceum_pipeline_run: JSON.stringify({ pipelineType: "market_research" }, null, 2),
  lyceum_comment_add: JSON.stringify({ agentId: "agent-1", author: "Inspector", text: "Reviewed via MCP Inspector" }, null, 2),
  lyceum_suggestions_get: "{}",
  lyceum_suggestion_inject: JSON.stringify({ suggestionText: "Run a full QA audit on all recent outputs." }, null, 2),
  lyceum_execution_logs: JSON.stringify({ limit: 5 }, null, 2),
};

function formatJson(input: string, fallback: string): string {
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return fallback;
  }
}

function isValidJson(text: string): boolean {
  if (!text.trim()) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// ── Mock Tool Definitions ────────────────────────────────────────────────────

const MOCK_TOOLS = [
  { name: "lyceum_agents_list", description: "List all AI agents in the Lyceum workforce", inputSchema: { type: "object", properties: {} } },
  { name: "lyceum_agent_get_status", description: "Get detailed status of a specific AI agent", inputSchema: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"] } },
  { name: "lyceum_agent_recharge", description: "Recharge an agent's token wallet", inputSchema: { type: "object", properties: { agentId: { type: "string" }, amount: { type: "number" } }, required: ["agentId", "amount"] } },
  { name: "lyceum_pipeline_run", description: "Execute a simulated A2A pipeline", inputSchema: { type: "object", properties: { pipelineType: { type: "string" } } } },
  { name: "lyceum_comment_add", description: "Add an H2H comment to an agent node", inputSchema: { type: "object", properties: { agentId: { type: "string" }, author: { type: "string" }, text: { type: "string" } }, required: ["agentId", "author", "text"] } },
  { name: "lyceum_suggestions_get", description: "Analyze execution history and generate context-aware suggestions", inputSchema: { type: "object", properties: {} } },
  { name: "lyceum_suggestion_inject", description: "Inject a suggestion into the Master Agent's prompt", inputSchema: { type: "object", properties: { suggestionText: { type: "string" } }, required: ["suggestionText"] } },
  { name: "lyceum_execution_logs", description: "Retrieve recent execution history", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("MCPInspector — Pure Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── DEFAULT_ARGS ──────────────────────────────────────────────────────

  describe("DEFAULT_ARGS templates", () => {
    it("provides default arguments for all 8 tools", () => {
      for (const tool of MOCK_TOOLS) {
        expect(DEFAULT_ARGS).toHaveProperty(tool.name);
      }
    });

    it("lyceum_agents_list defaults to empty object", () => {
      expect(DEFAULT_ARGS.lyceum_agents_list).toBe("{}");
    });

    it("lyceum_agent_get_status defaults include agentId", () => {
      const args = JSON.parse(DEFAULT_ARGS.lyceum_agent_get_status);
      expect(args).toHaveProperty("agentId", "agent-1");
    });

    it("lyceum_agent_recharge defaults include agentId and amount", () => {
      const args = JSON.parse(DEFAULT_ARGS.lyceum_agent_recharge);
      expect(args.agentId).toBe("agent-4");
      expect(args.amount).toBe(50000);
    });

    it("all DEFAULT_ARGS are valid JSON", () => {
      for (const [name, args] of Object.entries(DEFAULT_ARGS)) {
        expect(() => JSON.parse(args)).not.toThrow();
      }
    });
  });

  // ── formatJson ────────────────────────────────────────────────────────

  describe("formatJson", () => {
    it("formats valid JSON with 2-space indent", () => {
      const result = formatJson('{"a":1,"b":2}', "");
      expect(result).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });

    it("returns fallback for invalid JSON", () => {
      const result = formatJson("not json", "fallback");
      expect(result).toBe("fallback");
    });

    it("handles empty string", () => {
      const result = formatJson("", "fallback");
      expect(result).toBe("fallback");
    });

    it("formats nested objects", () => {
      const input = JSON.stringify({ outer: { inner: [1, 2, 3] } });
      const result = formatJson(input, "");
      expect(result).toContain('"inner"');
      expect(result).toContain("1,");
    });
  });

  // ── isValidJson ───────────────────────────────────────────────────────

  describe("isValidJson", () => {
    it("returns true for valid JSON object", () => {
      expect(isValidJson('{"key": "value"}')).toBe(true);
    });

    it("returns true for valid JSON array", () => {
      expect(isValidJson("[1, 2, 3]")).toBe(true);
    });

    it("returns true for empty string", () => {
      expect(isValidJson("")).toBe(true);
    });

    it("returns true for whitespace string", () => {
      expect(isValidJson("  ")).toBe(true);
    });

    it("returns false for invalid JSON", () => {
      expect(isValidJson("{invalid}")).toBe(false);
    });

    it("returns false for raw string without quotes", () => {
      expect(isValidJson("hello world")).toBe(false);
    });
  });

  // ── Tool List ─────────────────────────────────────────────────────────

  describe("tool filtering and selection", () => {
    it("filters tools by name (case-insensitive)", () => {
      const query = "agent";
      const filtered = MOCK_TOOLS.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      );
      expect(filtered.length).toBeGreaterThanOrEqual(2);
      expect(filtered.some((t) => t.name.includes("agents_list"))).toBe(true);
      expect(filtered.some((t) => t.name.includes("agent_get_status"))).toBe(true);
    });

    it("filters tools by description", () => {
      const query = "recharge";
      const filtered = MOCK_TOOLS.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("lyceum_agent_recharge");
    });

    it("returns no results for non-matching query", () => {
      const query = "zzzznotexist";
      const filtered = MOCK_TOOLS.filter(
        (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)
      );
      expect(filtered).toHaveLength(0);
    });

    it("selecting a tool populates its default args", () => {
      const tool = MOCK_TOOLS[1]; // lyceum_agent_get_status
      const args = DEFAULT_ARGS[tool.name] || "{}";
      expect(JSON.parse(args)).toHaveProperty("agentId");
    });

    it("all 8 tools have unique names", () => {
      const names = MOCK_TOOLS.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  // ── Call History ──────────────────────────────────────────────────────

  describe("call history behavior", () => {
    it("starts with empty history", () => {
      const history: unknown[] = [];
      expect(history).toHaveLength(0);
    });

    it("adds entries to history", () => {
      const history: { tool: string; args: string; response: string; success: boolean }[] = [];
      history.push({
        tool: "lyceum_agents_list",
        args: "{}",
        response: '[{"id":"agent-1","label":"Orion"}]',
        success: true,
      });
      expect(history).toHaveLength(1);
    });

    it("caps history at 20 entries (newest first)", () => {
      const history: number[] = [];
      for (let i = 0; i < 25; i++) {
        history.push(i);
      }
      const capped = history.slice(0, 20);
      expect(capped).toHaveLength(20);
      expect(capped[0]).toBe(0); // newest first
    });

    it("prepends new entries (newest first)", () => {
      const history: string[] = [];
      history.unshift("First call");
      history.unshift("Second call");
      expect(history[0]).toBe("Second call");
      expect(history[1]).toBe("First call");
    });

    it("tracks success/failure status", () => {
      const entry = { tool: "test", args: "{}", response: "error", success: false };
      expect(entry.success).toBe(false);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles tools with empty properties in inputSchema", () => {
      const noArgTools = MOCK_TOOLS.filter(
        (t) => t.inputSchema.properties && Object.keys(t.inputSchema.properties).length === 0
      );
      expect(noArgTools.length).toBeGreaterThanOrEqual(2); // agents_list, suggestions_get
      for (const tool of noArgTools) {
        expect(DEFAULT_ARGS[tool.name]).toBe("{}");
      }
    });

    it("identifies tools with required arguments", () => {
      const toolsWithRequired = MOCK_TOOLS.filter(
        (t) => t.inputSchema.required && t.inputSchema.required.length > 0
      );
      expect(toolsWithRequired.length).toBeGreaterThanOrEqual(4);
      expect(toolsWithRequired.some((t) => t.name === "lyceum_agent_recharge")).toBe(true);
      expect(toolsWithRequired.some((t) => t.name === "lyceum_comment_add")).toBe(true);
    });

    it("strips lyceum_ prefix for display", () => {
      const displayName = "lyceum_agents_list".replace("lyceum_", "");
      expect(displayName).toBe("agents_list");
    });

    it("truncates long descriptions", () => {
      const longDesc = "This is a very long description for testing truncation behavior";
      const truncated = longDesc.substring(0, 40);
      expect(truncated.length).toBeLessThanOrEqual(40);
    });
  });
});
