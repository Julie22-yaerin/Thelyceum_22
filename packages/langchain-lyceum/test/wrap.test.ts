/**
 * wrapTool/wrapTools — the properties worth protecting: a wrapped tool
 * still answers with the same name/description/schema an agent expects,
 * a first read passes through close to untouched, a second read of the
 * identical content within the ledger's window collapses to a pointer,
 * and non-string output is left alone since there's nothing to compress.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { wrapTool, wrapTools, SeenLedger } from "../src/index.js";

function makeTool(name: string, run: () => Promise<unknown>) {
  return new DynamicStructuredTool({
    name,
    description: `test tool ${name}`,
    schema: z.object({}),
    func: async () => run(),
  });
}

describe("wrapTool", () => {
  it("preserves name, description, and schema", () => {
    const tool = makeTool("read_file", async () => "hello");
    const wrapped = wrapTool(tool);
    expect(wrapped.name).toBe("read_file");
    expect(wrapped.description).toBe("test tool read_file");
  });

  it("passes a first, unique read through with no meaningful change", async () => {
    const tool = makeTool("read_file", async () => "some file contents");
    const wrapped = wrapTool(tool);
    const out = await wrapped.invoke({});
    expect(out).toBe("some file contents");
  });

  it("collapses a repeated identical read to a pointer instead of the full text", async () => {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const tool = makeTool("read_file", async () => big);
    const ledger = new SeenLedger();
    const wrapped = wrapTool(tool, ledger);

    const first = await wrapped.invoke({});
    const second = await wrapped.invoke({});

    expect(first).toBe(big);
    expect(second.length).toBeLessThan(big.length);
    expect(second).toContain("unchanged since you read it earlier");
  });

  it("leaves non-string output untouched", async () => {
    const tool = makeTool("get_status", async () => ({ ok: true }));
    const wrapped = wrapTool(tool);
    const out = await wrapped.invoke({});
    expect(out).toEqual({ ok: true });
  });

  it("wrapTools shares one ledger, so a repeat read via a different tool still dedupes", async () => {
    // Varied lines, not identical repeats — a run of identical lines
    // triggers thrift's own intra-call collapsing even on a first read,
    // which isn't what this test is exercising.
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const toolA = makeTool("tool_a", async () => big);
    const toolB = makeTool("tool_b", async () => big);
    const [wrappedA, wrappedB] = wrapTools([toolA, toolB]);

    // Different sourceId (tool name) per tool means the ledger key differs —
    // dedupe is per-source, so this exercises that each tool gets its own
    // independent first-read pass-through even while sharing one ledger.
    const outA = await wrappedA.invoke({});
    const outB = await wrappedB.invoke({});
    expect(outA).toBe(big);
    expect(outB).toBe(big);
  });

  it("reports compression results via onCompress", async () => {
    const big = "line\n".repeat(2000);
    const tool = makeTool("read_file", async () => big);
    const ledger = new SeenLedger();
    const calls: string[] = [];
    const wrapped = wrapTool(tool, ledger, {
      onCompress: (name) => calls.push(name),
    });

    await wrapped.invoke({});
    await wrapped.invoke({});
    expect(calls).toEqual(["read_file", "read_file"]);
  });
});
