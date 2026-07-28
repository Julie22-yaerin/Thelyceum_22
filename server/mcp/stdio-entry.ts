#!/usr/bin/env node
/**
 * Lyceum MCP Stdio Entry Point
 *
 * Run standalone:
 *   node dist/mcp/stdio-entry.js
 *
 * Or configure in Claude Desktop:
 *   {
 *     "mcpServers": {
 *       "lyceum": {
 *         "command": "node",
 *         "args": ["/path/to/dist/mcp/stdio-entry.js"]
 *       }
 *     }
 *   }
 */

import { startStdioServer } from "./stdio-transport";

startStdioServer();
