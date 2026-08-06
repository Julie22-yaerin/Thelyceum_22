#!/usr/bin/env node
/**
 * The red team MCP server.
 *
 * Exposes three tools over stdio:
 *   - challenge       scan a claim/plan for one-sided reasoning
 *   - rebut           quick devil's advocate: counters + verdict only
 *   - redteam_status  read recent challenge events from the audit log
 *
 * Tool descriptions are mode-aware. In 'always' mode (default) the model
 * calls them proactively — it attacks its own conclusion before presenting
 * it, without the user asking. In 'slash' mode the descriptions tell the
 * model to ONLY call them when the user explicitly types /redteam. The mode
 * is read from `~/.redteam/config.json` at startup; change it with
 * `redteam mode ...` and restart the host.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { challenge, rebut, listFlawRules } from "./challenge.js";
import { readAudit } from "./audit.js";
import { loadConfig } from "./config.js";
import { getMode, challengeDescriptionFor, rebutDescriptionFor } from "./mode.js";
import { reportChallenge } from "./notify.js";
import { TARGET } from "./variant.js";
import { checkTrialLimits } from "./trial.js";

const mode = await getMode();
const cfg = await loadConfig();

const server = new McpServer({
  name: "redteam",
  version: "0.1.0",
});

server.tool(
  "challenge",
  challengeDescriptionFor(mode),
  {
    text: z.string()
      .describe("The claim, plan, or piece of reasoning to challenge. Will be scanned for one-sided reasoning."),
  },
  async ({ text }) => {
    if (TARGET === "local-trial") checkTrialLimits();
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
    if (TARGET === "local-trial") checkTrialLimits();
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

const transport = new StdioServerTransport();
await server.connect(transport);
