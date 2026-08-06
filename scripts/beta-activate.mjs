#!/usr/bin/env node
// Installs a beta license key so brake/redteam/thrift's beta gate picks it
// up. Writes ~/.lyceum/beta-license.json — the same file every tool's
// beta.ts checks against LYCEUM_SERVER_URL (or the production default) on
// each real tool call. No-op with a clear message if the key is missing.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const key = process.argv[2];
if (!key) {
  console.error("Usage: node scripts/beta-activate.mjs <LYCEUM-BETA-...>");
  process.exit(1);
}

const dir = join(homedir(), ".lyceum");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(join(dir, "beta-license.json"), JSON.stringify({ licenseKey: key }, null, 2), { mode: 0o600 });

console.log(`Beta license installed at ${join(dir, "beta-license.json")}`);
console.log("brake, redteam, and thrift will now check in with the license server on each real tool call.");
