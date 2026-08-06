import { describe, it, expect } from "vitest";
import { ToolCatalog, SkillCatalog } from "../src/catalog.js";

describe("ToolCatalog and SkillCatalog", () => {
  it("registers tools and performs search and invocation with auto-compression", async () => {
    const catalog = new ToolCatalog();
    catalog.register({
      id: "get_user_logs",
      name: "get_user_logs",
      description: "Fetch server audit logs for a user.",
      execute: async () => "LOG_LINE: User login at 10:00\n".repeat(20),
    });

    const searchRes = catalog.search("user logs");
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].tool.id).toBe("get_user_logs");

    const inv1 = await catalog.invoke("get_user_logs");
    expect(inv1.compressedText).toContain("LOG_LINE");

    // Second invocation should trigger SeenLedger deduplication pointer
    const inv2 = await catalog.invoke("get_user_logs");
    expect(inv2.compressedText).toContain("unchanged since you read it");
  });

  it("registers skills and retrieves progressive disclosure body", () => {
    const skills = new SkillCatalog();
    skills.register({
      id: "debug_auth_flow",
      name: "debug_auth_flow",
      description: "Playbook for debugging authentication failures.",
      body: "Step 1: Read auth log.\nStep 2: Verify JWT signature.",
      tools: ["get_user_logs"],
    });

    const searchRes = skills.search("authentication debugging");
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].skill.id).toBe("debug_auth_flow");

    const content = skills.getSkillContent("debug_auth_flow");
    expect(content.body).toContain("Verify JWT signature");
  });
});
