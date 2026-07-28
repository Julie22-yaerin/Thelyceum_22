/**
 * Vercel serverless entry point — wraps the shared Express API app
 * (server/index.ts). Pre-bundled by `scripts/build-vercel-function.mjs`
 * into api/index.js (gitignored build artifact, generated during
 * `pnpm run build` — see vercel.json's buildCommand) with
 * --packages=external, i.e. express/firebase-admin/etc. are left as plain
 * `import`/`require` calls instead of being inlined into one file.
 *
 * This is deliberate, not an optimization: esbuild CANNOT fully inline
 * several of our CommonJS dependencies (express's own transitive deps, e.g.
 * `depd`) into a single ESM bundle — it throws `Dynamic require of "x" is
 * not supported` at runtime. That crash is exactly what Vercel's own
 * zero-config Node builder was hitting (surfaced as
 * FUNCTION_INVOCATION_FAILED) when it tried to bundle this file itself.
 * Pre-bundling with the working esbuild flags sidesteps trusting Vercel's
 * internal bundler to get this right.
 *
 * Not used for other deploy targets: those run server/index.ts directly as a
 * persistent Node process via `npm start`, which also gets static file
 * serving, the SPA fallback, and the MCP WebSocket endpoint — none of which
 * are available in a stateless serverless function.
 */

import { createApiApp } from "./index.js";

const app = createApiApp();

export default app;
