#!/usr/bin/env node
/**
 * The red team MCP server.
 *
 * Exposes four tools over stdio:
 *   - challenge       scan a claim/plan/code for reasoning & code flaws (warns vs blocks)
 *   - rebut           quick devil's advocate: counters + verdict only
 *   - compact         smart context compacting: strips hesitation fillers & duplicated words
 *   - redteam_status  read recent challenge events from the audit log
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { challenge, rebut, listFlawRules } from "./challenge.js";
import { compactContext } from "./compact.js";
import { readAudit } from "./audit.js";
import { loadConfig } from "./config.js";
import { getMode, challengeDescriptionFor, rebutDescriptionFor } from "./mode.js";
import { reportChallenge } from "./notify.js";
import { checkLicenseGate } from "./gate.js";

const mode = await getMode();
const cfg = await loadConfig();

const server = new McpServer({
  name: "redteam",
  version: "1.0.0",
});

server.tool(
  "challenge",
  challengeDescriptionFor(mode),
  {
    text: z.string()
      .describe("The claim, plan, or piece of code to challenge. Scanned for reasoning flaws and code risks."),
  },
  async ({ text }) => {
    const gate = await checkLicenseGate();
    if (!gate.allowed) {
      return { content: [{ type: "text", text: gate.message ?? "License check failed." }], isError: true };
    }

    const result = challenge(text, { blockOn: cfg.blockOn });
    if (result.flags.length > 0) {
      await reportChallenge(cfg, result);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.verdict.blocked,
    };
  }
);

server.tool(
  "rebut",
  rebutDescriptionFor(mode),
  {
    text: z.string()
      .describe("The claim or plan to get a devil's advocate on."),
  },
  async ({ text }) => {
    const gate = await checkLicenseGate();
    if (!gate.allowed) {
      return { content: [{ type: "text", text: gate.message ?? "License check failed." }], isError: true };
    }

    const result = rebut(text, { blockOn: cfg.blockOn });
    if (result.flags.length > 0) {
      await reportChallenge(cfg, result);
    }
    return {
      content: [{ type: "text", text: JSON.stringify({ text: result.text, counter: result.counter, verdict: result.verdict }, null, 2) }],
      isError: result.verdict.blocked,
    };
  }
);

server.tool(
  "compact",
  "Filter hesitation fillers (uh, um, ừm, à) and duplicate words from context without losing technical terms or logical structure.",
  {
    text: z.string().describe("The text or context to compact."),
  },
  async ({ text }) => {
    const gate = await checkLicenseGate();
    if (!gate.allowed) {
      return { content: [{ type: "text", text: gate.message ?? "License check failed." }], isError: true };
    }

    const result = compactContext(text);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "redteam_status",
  "Read the most recent challenge events from the audit log. Shows when the red team flagged reasoning, which flaws matched, and whether the verdict blocked.",
  {
    limit: z.number().int().min(1).max(200).optional()
      .describe("Max events to return. Default 20."),
  },
  async ({ limit }) => {
    const events = await readAudit(limit ?? 20, cfg.auditPath);
    return {
      content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
    };
  }
);

server.resource(
  "redteam://rules",
  "The list of flaw rules the red team watches. Read this to see what gets challenged.",
  async () => ({
    contents: [{
      uri: "redteam://rules",
      mimeType: "application/json",
      text: JSON.stringify(listFlawRules(), null, 2),
    }],
  })
);

server.resource(
  "redteam://mode",
  "The current red team mode. 'always' = model challenges its own reasoning proactively. 'slash' = only on explicit /redteam.",
  async () => ({
    contents: [{
      uri: "redteam://mode",
      mimeType: "application/json",
      text: JSON.stringify({ mode, configPath: "~/.redteam/config.json" }, null, 2),
    }],
  })
);

server.prompt(
  "redteam_logic_challenge",
  "Challenge a proposal, plan, or code edit for reasoning flaws, overconfidence, context drift, or ping-pong loops",
  { proposal: z.string().describe("The proposal or code edit to challenge") },
  async ({ proposal }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `[RED TEAM LOGIC CHALLENGE]: Challenge this proposal for reasoning flaws, context drift, or loop risks:\n\n${proposal}` },
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
