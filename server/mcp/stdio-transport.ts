/**
 * Lyceum MCP Stdio Transport
 *
 * Allows stdio-based MCP clients (Claude Desktop, Cursor, VS Code MCP extension)
 * to connect to the Lyceum workforce server via standard input/output.
 *
 * Usage (in Claude Desktop config):
 * {
 *   "mcpServers": {
 *     "lyceum": {
 *       "command": "node",
 *       "args": ["dist/mcp/stdio-entry.js"],
 *       "env": {
 *         "LYCEUM_MCP_PORT": "3001"
 *       }
 *     }
 *   }
 * }
 *
 * Or run standalone:
 *   node dist/mcp/stdio-entry.js
 */

import { handleRequest } from "./lyceum-mcp-server";
import { createInterface } from "readline";

/**
 * JSON-RPC 2.0 message wrapper for stdout
 */
function sendResponse(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/**
 * Start the MCP server in stdio mode.
 * Reads JSON-RPC messages from stdin, processes them, and writes results to stdout.
 */
export function startStdioServer(): void {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  // Log startup info to stderr so it doesn't interfere with the JSON-RPC stream
  console.error("[Lyceum MCP] Starting stdio transport...");
  console.error("[Lyceum MCP] Listening for JSON-RPC messages on stdin");

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: { id?: number; method: string; params?: Record<string, unknown> };
    try {
      request = JSON.parse(trimmed);
    } catch {
      sendResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    try {
      const result = await handleRequest(request.method, request.params || {});
      if (request.id !== undefined) {
        sendResponse({ jsonrpc: "2.0", id: request.id, result });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Internal error";
      if (request.id !== undefined) {
        sendResponse({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: errorMessage } });
      }
    }
  });

  rl.on("close", () => {
    console.error("[Lyceum MCP] stdin closed, shutting down");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.error("[Lyceum MCP] SIGINT received, shutting down");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("[Lyceum MCP] SIGTERM received, shutting down");
    process.exit(0);
  });
}
