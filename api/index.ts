/**
 * Vercel serverless entry point — wraps the shared Express API app
 * (server/index.ts) so every /api/* request is routed here by vercel.json.
 *
 * Not used for other deploy targets: those run server/index.ts directly as a
 * persistent Node process via `npm start`, which also gets static file
 * serving, the SPA fallback, and the MCP WebSocket endpoint — none of which
 * are available in a stateless serverless function.
 */

import { createApiApp } from "../server/index.js";

const app = createApiApp();

export default app;
