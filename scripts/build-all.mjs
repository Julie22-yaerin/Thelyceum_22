#!/usr/bin/env node
// Manual/dev build convenience: cd into each package and run its own
// `npm run build`. Assumes a real `npm install` already ran at the repo
// root (normal local dev or CI) so each package's deps are hoisted and
// resolvable — this does NOT install anything itself.
//
// NOT wired to the "prepare" lifecycle script. It used to be, so that
// `npm install -g github:...` would build the CLIs on the fly — but a
// nested `npm install` run from inside a package directory gets detected
// by npm as "inside a workspace", which re-runs the ROOT package's own
// prepare script, which called this file again, which installed again...
// infinite recursion, spawning processes until the machine's RAM was gone.
// Ships pre-built dist/ for brake, redteam, and thrift in git instead, so
// a global install never needs to build anything at all.

import { spawnSync } from "node:child_process";

// packages/server is excluded: Railway builds and runs it separately, with
// its own explicit --workspace build command, and this script is not part
// of that path.
const packages = ["packages/brake", "packages/redteam", "packages/thrift"];

for (const pkg of packages) {
  const result = spawnSync("npm", ["run", "build", "--if-present"], {
    cwd: pkg,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
