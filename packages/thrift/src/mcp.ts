#!/usr/bin/env node
/**
 * The thrift (Saver) MCP server.
 *
 * Tools:
 *   read_lean      read a file, deduplicated against this session
 *   run_lean       run a command, compress its output
 *   check_loop     runaway loop interceptor (trips if action repeated > 2 times)
 *   compress_text  compress text the model already has in hand
 *   thrift_report  what has actually been saved, from the ledger
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  compress,
  SeenLedger,
  DEFAULT_MAX_DEDUPE_AGE_CALLS,
  DEFAULT_MAX_DEDUPE_AGE_TOKENS,
} from "./compress.js";
import { record, summarise } from "./ledger.js";
import { globalLoopTracker, MAX_ALLOWED_REPETITIONS } from "./loop.js";

const execAsync = promisify(exec);
const seen = new SeenLedger();
const DEFAULT_BUDGET = Number(process.env.THRIFT_BUDGET_TOKENS ?? 4000);

const DEDUPE_MAX_AGE_CALLS = Number(process.env.THRIFT_DEDUPE_MAX_AGE ?? DEFAULT_MAX_DEDUPE_AGE_CALLS);
const DEDUPE_MAX_AGE_TOKENS = Number(process.env.THRIFT_DEDUPE_MAX_AGE_TOKENS ?? DEFAULT_MAX_DEDUPE_AGE_TOKENS);

const server = new McpServer({ name: "thrift", version: "1.0.0" });

server.tool(
  "read_lean",
  "Read a file, but skip content this session has already seen. Prefer this over the host's own file read whenever working through a codebase.",
  {
    path: z.string().describe("Absolute or relative path to the file."),
    query: z.string().optional().describe("What you are looking for. Enables slicing large files."),
    budget_tokens: z.number().int().min(200).max(200_000).optional(),
  },
  async ({ path, query, budget_tokens }) => {
    const abs = resolve(path);
    let text: string;
    try {
      text = await fs.readFile(abs, "utf-8");
    } catch (err) {
      return {
        content: [{ type: "text", text: `Could not read ${abs}: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
    const result = compress(text, seen, {
      sourceId: abs,
      query,
      budgetTokens: budget_tokens ?? DEFAULT_BUDGET,
      maxDedupeAgeCalls: DEDUPE_MAX_AGE_CALLS,
      maxDedupeAgeTokens: DEDUPE_MAX_AGE_TOKENS,
    });
    await record(result, abs).catch(() => {});
    return {
      content: [{ type: "text", text: `${result.text}\n\n[thrift: ${result.note}]` }],
    };
  }
);

server.tool(
  "run_lean",
  "Run a shell command with machine noise removed. Also checks for runaway tool loops.",
  {
    command: z.string().describe("The shell command to run."),
    cwd: z.string().optional().describe("Working directory."),
    budget_tokens: z.number().int().min(200).max(200_000).optional(),
  },
  async ({ command, cwd, budget_tokens }) => {
    // Runaway loop check (Strict limit: MAX_ALLOWED_REPETITIONS = 2)
    const loopCheck = globalLoopTracker.trackAndCheck(`cmd:${command}`, 1000);
    if (loopCheck.tripped) {
      return {
        content: [{
          type: "text",
          text: `[THRIFT SAVER INTERCEPT]: ${loopCheck.reason}\nTokens Saved: ${loopCheck.tokensSaved} (~$${loopCheck.dollarsSaved} USD).\nPlease revise approach or ask user before repeating.`,
        }],
        isError: true,
      };
    }

    let raw: string;
    let failed = false;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
      });
      raw = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
    } catch (err) {
      failed = true;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      raw = (e.stdout ?? "") + (e.stderr ? `\n[stderr]\n${e.stderr}` : "") || (e.message ?? "command failed");
    }

    const result = compress(raw, seen, {
      budgetTokens: budget_tokens ?? DEFAULT_BUDGET,
    });
    await record(result, `cmd:${command.slice(0, 60)}`).catch(() => {});
    return {
      content: [{ type: "text", text: `${result.text}\n\n[thrift: ${result.note}]` }],
      isError: failed,
    };
  }
);

server.tool(
  "check_loop",
  "Runaway loop interceptor tool. Checks if an action or intent has repeated more than 2 times. Trips and intercepts execution if loop count > 2.",
  {
    action_key: z.string().describe("The tool name, command, or action signature to check."),
  },
  async ({ action_key }) => {
    const res = globalLoopTracker.trackAndCheck(action_key);
    return {
      content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      isError: res.tripped,
    };
  }
);

server.tool(
  "compress_text",
  "Compress a block of text you already have — returns compressed text plus what was removed.",
  {
    text: z.string().describe("The text to compress."),
    query: z.string().optional().describe("What matters in it."),
    budget_tokens: z.number().int().min(200).max(200_000).optional(),
  },
  async ({ text, query, budget_tokens }) => {
    const result = compress(text, seen, { query, budgetTokens: budget_tokens ?? DEFAULT_BUDGET });
    await record(result).catch(() => {});
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          text: result.text,
          before: result.before.tokens,
          after: result.after.tokens,
          saved: result.saved,
          applied: result.applied,
          note: result.note,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "thrift_report",
  "What thrift has actually saved, read back from the ledger.",
  { limit: z.number().int().min(1).max(50_000).optional() },
  async ({ limit }) => {
    const s = await summarise(limit ?? 5000);
    return { content: [{ type: "text", text: JSON.stringify(s, null, 2) }] };
  }
);

server.resource(
  "thrift://mechanisms",
  "thrift://mechanisms",
  async () => ({
    contents: [{
      uri: "thrift://mechanisms",
      mimeType: "text/plain",
      text: [
        "loop_interceptor — trips if an action repeats > 2 times. INTERCEPTS RUNAWAY LOOPS.",
        "dedupe — content already shown this session is replaced by a pointer. LOSSLESS.",
        "slice  — a query selects the relevant windows of a large file. LOSSY.",
        "strip  — ANSI codes, repeated log lines, STANDALONE base64 blobs, lockfile hashes. LOSSLESS.",
        "cap    — head+tail truncation at a token budget. LOSSY.",
      ].join("\n"),
    }],
  })
);

server.prompt(
  "thrift_compress_context",
  "Compress large context blocks, log outputs, or code patches to minimize token burn",
  { text: z.string().describe("The text or context to compress") },
  async ({ text }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `[THRIFT SAVER COMPRESSION REQUEST]:\n\n${text}` },
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
