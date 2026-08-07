#!/usr/bin/env node
// Builds each workspace package by cd-ing into it and running its own
// local `npm run build` — no `--workspaces`/`-w` flag anywhere. Those
// flags fail with "Workspaces not supported for global packages" when
// this runs as the `prepare` hook of `npm install -g github:...`, since
// npm's global-install context leaks into the nested npm invocation. A
// plain per-directory `npm run build` sidesteps that entirely.

import { spawnSync } from "node:child_process";

const packages = ["packages/brake", "packages/redteam", "packages/thrift", "packages/server"];

for (const pkg of packages) {
  const result = spawnSync("npm", ["run", "build", "--if-present"], {
    cwd: pkg,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
