/**
 * langchain-lyceum — drop-in token compression for LangChain.js tools.
 *
 * Wraps any StructuredTool so its output is run through The Lyceum's
 * compression engine before the agent ever sees it: repeated reads of the
 * same tool output collapse to a pointer, oversized results get capped,
 * and machine noise gets stripped. One shared ledger per `wrapTools()`
 * call means dedupe works across the whole agent run, not just per call.
 */

import { DynamicStructuredTool, type StructuredToolInterface } from "@langchain/core/tools";
import { compress, SeenLedger, type CompressOptions, type CompressResult } from "./thrift-core/compress.js";

export interface LyceumWrapOptions extends Pick<CompressOptions, "budgetTokens" | "maxDedupeAgeCalls" | "maxDedupeAgeTokens" | "enable"> {
  /** Called once per tool invocation with the compression result. Defaults to a no-op. */
  onCompress?: (toolName: string, result: CompressResult) => void;
  /** Print the "Powered by The Lyceum" watermark to stderr on first compression. Default true. */
  watermark?: boolean;
}

let watermarkPrinted = false;

function printWatermark(): void {
  if (watermarkPrinted) return;
  watermarkPrinted = true;
  console.error("⚡ Powered by The Lyceum (thelyceum.site) — token savings via thrift's compression engine");
}

/**
 * Wrap a single LangChain tool so its string output is compressed before
 * the agent loop consumes it. Non-string outputs are passed through
 * unchanged — there's nothing to compress.
 */
export function wrapTool(
  tool: StructuredToolInterface,
  ledger: SeenLedger = new SeenLedger(),
  options: LyceumWrapOptions = {}
): DynamicStructuredTool {
  const watermark = options.watermark !== false;

  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema as never,
    func: async (input, runManager, config) => {
      const raw = await tool.invoke(input, config);
      if (typeof raw !== "string") return raw;

      const result = compress(raw, ledger, {
        budgetTokens: options.budgetTokens,
        sourceId: tool.name,
        maxDedupeAgeCalls: options.maxDedupeAgeCalls,
        maxDedupeAgeTokens: options.maxDedupeAgeTokens,
        enable: options.enable,
      });

      if (watermark && result.saved > 0) printWatermark();
      options.onCompress?.(tool.name, result);
      return result.text;
    },
  });
}

/**
 * Wrap a list of tools, sharing one ledger across all of them so a repeat
 * read of the same content — even from a different tool — still dedupes.
 */
export function wrapTools(
  tools: StructuredToolInterface[],
  options: LyceumWrapOptions = {}
): DynamicStructuredTool[] {
  const ledger = new SeenLedger();
  return tools.map((t) => wrapTool(t, ledger, options));
}

export { SeenLedger } from "./thrift-core/compress.js";
export type { CompressResult, CompressOptions, Mechanism } from "./thrift-core/compress.js";
