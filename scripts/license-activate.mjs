#!/usr/bin/env node
// Installs a paid subscription license key so brake/redteam/thrift's
// license gate picks it up. Writes ~/.lyceum/license.json — separate from
// beta-license.json so a subscription key and a leftover beta key never
// collide; the subscription key always wins if both are present.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const key = process.argv[2];
if (!key) {
  console.error("Usage: node scripts/license-activate.mjs <LYCEUM-SUB-...>");
  process.exit(1);
}

const dir = join(homedir(), ".lyceum");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(join(dir, "license.json"), JSON.stringify({ licenseKey: key }, null, 2), { mode: 0o600 });

console.log(`License installed at ${join(dir, "license.json")}`);
console.log("brake, redteam, and thrift will now check in with the license server on each real tool call.");
console.log("When it expires, the tools will point you back to the site for a new code.");
