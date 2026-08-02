#!/usr/bin/env node
/**
 * The thrift MCP server.
 *
 * ── The shape of the problem, stated plainly ────────────────────────────────
 * An MCP server cannot see the conversation. It cannot prune history, cannot
 * touch the system prompt, and cannot intercept another server's tool results.
 * Anything claiming to cut your context by 40% from inside MCP is describing
 * something it structurally cannot do.
 *
 * What it CAN do is be the thing the model reads files and runs commands
 * THROUGH. When `read_lean` replaces the host's own file read, the tokens that
 * would have entered the context never do. That is the whole mechanism, and it
 * only works if the model actually prefers these tools — which is what the
 * skill description is for.
 *
 * Four tools:
 *   read_lean     read a file, deduplicated against this session
 *   run_lean      run a command, compress its output
 *   compress_text compress text the model already has in hand
 *   thrift_report what has actually been saved, from the ledger
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { compress, SeenLedger } from "./compress.js";
import { record, summarise } from "./ledger.js";

const execAsync = promisify(exec);

/**
 * One ledger per server process.
 *
 * An MCP stdio server is started per host session, so process lifetime and
 * session lifetime are the same thing. That is exactly the scope dedupe needs:
 * telling a fresh conversation "you already have this" would be false and
 * unrecoverable, because the model has no way to fetch what it was never given.
 */
const seen = new SeenLedger();

const DEFAULT_BUDGET = Number(process.env.THRIFT_BUDGET_TOKENS ?? 4000);

const server = new McpServer({ name: "thrift", version: "0.1.0" });

server.tool(
  "read_lean",
  "Read a file, but skip content this session has already seen. Prefer this over the host's own file read whenever you are working through a codebase — on a second read of the same unchanged file it returns a short pointer instead of the full text, which is the single largest saving available in an iterative loop. Pass `query` when you are looking for something specific and it will return the relevant windows instead of the whole file.",
  {
    path: z.string().describe("Absolute or relative path to the file."),
    query: z.string().optional().describe("What you are looking for. Enables slicing large files to the relevant windows."),
    budget_tokens: z.number().int().min(200).max(200_000).optional()
      .describe(`Cap on returned tokens. Default ${DEFAULT_BUDGET}. Raise it if a previous read came back truncated.`),
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
    const result = compress(text, seen, { sourceId: abs, query, budgetTokens: budget_tokens ?? DEFAULT_BUDGET });
    await record(result, abs).catch(() => {});
    return {
      content: [{ type: "text", text: `${result.text}\n\n[thrift: ${result.note}]` }],
    };
  }
);

server.tool(
  "run_lean",
  "Run a shell command and return its output with machine noise removed — ANSI colour codes, repeated log lines, base64 blobs, lockfile hashes. Prefer this over a raw shell tool for anything that produces long output (installs, test runs, builds, greps): the removed bytes carry no meaning for you, and on a verbose command this is most of the output.",
  {
    command: z.string().describe("The shell command to run."),
    cwd: z.string().optional().describe("Working directory."),
    budget_tokens: z.number().int().min(200).max(200_000).optional()
      .describe(`Cap on returned tokens. Default ${DEFAULT_BUDGET}.`),
  },
  async ({ command, cwd, budget_tokens }) => {
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
      // A failed command's output is the MOST valuable output there is — it
      // has the error. Compress it, never discard it.
      raw = (e.stdout ?? "") + (e.stderr ? `\n[stderr]\n${e.stderr}` : "") || (e.message ?? "command failed");
    }

    const result = compress(raw, seen, {
      // No sourceId: command output is not deduplicated, because two runs of
      // the same command are meant to be compared, and telling the model
      // "same as last time" would hide the very change it is checking for.
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
  "compress_text",
  "Compress a block of text you already have — a long tool result, a pasted log, a large document — before working with it further. Returns the compressed text plus what was removed.",
  {
    text: z.string().describe("The text to compress."),
    query: z.string().optional().describe("What matters in it. Enables slicing to relevant windows."),
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
  "What thrift has actually saved, read back from the ledger. Reports deduplication separately from truncation, because only one of those is free.",
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
        "dedupe — content already shown this session is replaced by a pointer. LOSSLESS.",
        "slice  — a query selects the relevant windows of a large file. LOSSY, gaps are marked with line ranges.",
        "strip  — ANSI codes, repeated log lines, base64 blobs, lockfile hashes. LOSSLESS.",
        "cap    — head+tail truncation at a token budget. LOSSY, announced in the payload.",
        "",
        "Savings depend entirely on the workload. Deduplication does nothing on a first read",
        "and a great deal in an iterative loop. thrift measures each call rather than",
        "claiming a fixed percentage.",
      ].join("\n"),
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
