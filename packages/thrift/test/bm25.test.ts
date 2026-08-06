import { describe, it, expect } from "vitest";
import { BM25Engine } from "../src/bm25.js";

describe("BM25Engine", () => {
  it("tokenize handles camelCase and snake_case correctly", () => {
    const tokens = BM25Engine.tokenize("read_file inspectLocalFile search_capabilities_tool");
    expect(tokens).toContain("read");
    expect(tokens).toContain("file");
    expect(tokens).toContain("inspect");
    expect(tokens).toContain("local");
    expect(tokens).toContain("search");
    expect(tokens).toContain("capabilities");
  });

  it("indexes documents and ranks search query correctly", () => {
    const engine = new BM25Engine();
    engine.addDocuments([
      {
        id: "tool_read_file",
        fields: {
          name: "read_file",
          description: "Read a local file from disk.",
          tags: ["file", "io"],
        },
      },
      {
        id: "tool_execute_sql",
        fields: {
          name: "execute_sql",
          description: "Run SQL query on database.",
          tags: ["db", "sql"],
        },
      },
    ]);

    const results = engine.search("read disk file");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].document.id).toBe("tool_read_file");
  });
});
