#!/usr/bin/env node
/**
 * Package & Distribution Manager for Lyceum.
 * Organizes packages into:
 *   1. Beta Trial Pack (Bản Dùng Thử - Built dist/ ONLY, NO TypeScript source code, NO internal tests)
 *   2. Commercial Release Pack (Bản Bán Thương Mại - Full enterprise monorepo suite with licensing server)
 */

import { promises as fs } from "node:fs";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(".");
const DIST_RELEASES = join(ROOT, "dist-releases");
const BETA_DIR = join(DIST_RELEASES, "beta-trial");
const COMMERCIAL_DIR = join(DIST_RELEASES, "commercial-enterprise");

const PACKAGES = [
  { name: "brake", path: "packages/brake" },
  { name: "redteam", path: "packages/redteam" },
  { name: "thrift", path: "packages/thrift" },
];

async function cleanDir(dir) {
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.mkdir(dir, { recursive: true });
}

async function copyRecursive(src, dest, filterFn) {
  if (!existsSync(src)) return;
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      const srcPath = join(src, entry);
      const destPath = join(dest, entry);
      if (filterFn ? filterFn(srcPath, entry) : true) {
        await copyRecursive(srcPath, destPath, filterFn);
      }
    }
  } else {
    if (filterFn ? filterFn(src, dest) : true) {
      await fs.copyFile(src, dest);
    }
  }
}

async function buildBetaTrialPack() {
  console.log("\n📦 Packaging BETA TRIAL RELEASE (Bản Dùng Thử - Compiled dist/ only, NO source)...");
  await cleanDir(BETA_DIR);

  for (const pkg of PACKAGES) {
    const pkgSrcPath = join(ROOT, pkg.path);
    const pkgDestPath = join(BETA_DIR, pkg.name);

    if (!existsSync(join(pkgSrcPath, "dist"))) {
      console.log(`Building ${pkg.name}...`);
      execSync("npm run build", { cwd: pkgSrcPath, stdio: "inherit" });
    }

    // Copy dist, package.json, README.md, LICENSE, skills (EXCLUDE src/, test/, node_modules/, tsconfig)
    await fs.mkdir(pkgDestPath, { recursive: true });
    
    // Copy dist directory
    await copyRecursive(join(pkgSrcPath, "dist"), join(pkgDestPath, "dist"));
    
    // Copy package.json & clean devDependencies / ts scripts
    if (existsSync(join(pkgSrcPath, "package.json"))) {
      const pkgJsonRaw = await fs.readFile(join(pkgSrcPath, "package.json"), "utf-8");
      const pkgJson = JSON.parse(pkgJsonRaw);
      delete pkgJson.devDependencies;
      delete pkgJson.scripts?.test;
      delete pkgJson.scripts?.["test:watch"];
      await fs.writeFile(join(pkgDestPath, "package.json"), JSON.stringify(pkgJson, null, 2));
    }

    if (existsSync(join(pkgSrcPath, "README.md"))) {
      await fs.copyFile(join(pkgSrcPath, "README.md"), join(pkgDestPath, "README.md"));
    }
    if (existsSync(join(pkgSrcPath, "LICENSE"))) {
      await fs.copyFile(join(pkgSrcPath, "LICENSE"), join(pkgDestPath, "LICENSE"));
    }
    if (existsSync(join(pkgSrcPath, "skills"))) {
      await copyRecursive(join(pkgSrcPath, "skills"), join(pkgDestPath, "skills"));
    }
    if (existsSync(join(pkgSrcPath, "python"))) {
      await copyRecursive(join(pkgSrcPath, "python"), join(pkgDestPath, "python"));
    }

    console.log(`  ✓ Created clean Beta Trial package for @lyceum/${pkg.name} (dist/ only)`);
  }

  // Create a root README for the client receiving the Beta Trial pack
  const betaReadme = `# Lyceum Security & Context Suite — Beta Trial Release

Welcome to the Lyceum Beta Trial Release.

## Included Packages (Production Pre-compiled Artifacts)

1. \`brake\` — Emergency Safety Brake, Threat Scanner, & Sandbox Guardrail (<1ms SLA)
2. \`redteam\` — Automated Code Risk & Reasoning Auditor (Dual-tier WARN/BLOCK engine)
3. \`thrift\` — Dual-Sided Context Optimization Engine (BM25 Catalog + Lossless SeenLedger Deduplication)

## Installation & Setup

\`\`\`bash
# Install packages globally or link to your project
cd brake && npm link
cd ../redteam && npm link
cd ../thrift && npm link
\`\`\`

## Wire into AI Agent Host / MCP

\`\`\`bash
thrift install all
brake install all
redteam install all
\`\`\`

## License & Trial Terms

Active under 30-day Trial License (\`LYCEUM-TRIAL-30D\`).
Compiled production artifacts only. For commercial source license inquiries, contact enterprise sales.
`;
  await fs.writeFile(join(BETA_DIR, "README.md"), betaReadme);

  // Zip the beta trial package
  const zipPath = join(DIST_RELEASES, "lyceum-beta-trial-v1.0.0.zip");
  if (existsSync(zipPath)) await fs.unlink(zipPath);

  try {
    execSync(`zip -r -q "${zipPath}" "beta-trial"`, { cwd: DIST_RELEASES });
    console.log(`\n🎉 Beta Trial ZIP generated: ${zipPath}`);
  } catch (err) {
    console.log(`Beta trial folder ready at: ${BETA_DIR}`);
  }
}

async function buildCommercialPack() {
  console.log("\n💰 Packaging COMMERCIAL ENTERPRISE RELEASE (Bản Bán Thương Mại - Monorepo Suite)...");
  await cleanDir(COMMERCIAL_DIR);

  // Copy full monorepo packages including licensing server and master key auth
  const commPackages = ["brake", "redteam", "thrift", "server", "session-guard", "lyceum-core"];
  for (const pkgName of commPackages) {
    const srcPath = join(ROOT, "packages", pkgName);
    if (existsSync(srcPath)) {
      const destPath = join(COMMERCIAL_DIR, "packages", pkgName);
      await copyRecursive(srcPath, destPath, (src) => !src.includes("node_modules") && !src.includes(".git"));
      console.log(`  ✓ Packaged Commercial Enterprise module: ${pkgName}`);
    }
  }

  const commReadme = `# Lyceum Enterprise Commercial Suite

Commercial Release monorepo including Master Key Session Guard, Enterprise Licensing Server, SLA Guardrails, & SLA Audit Logs.

For setup and deployment instructions, see system architecture documentation.
`;
  await fs.writeFile(join(COMMERCIAL_DIR, "README.md"), commReadme);
  console.log(`\n🎉 Commercial Enterprise release ready at: ${COMMERCIAL_DIR}`);
}

async function main() {
  const arg = process.argv[2] ?? "--all";

  // Ensure fresh build of all packages
  console.log("Building TypeScript outputs across monorepo...");
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

  if (arg === "--beta" || arg === "--all") {
    await buildBetaTrialPack();
  }
  if (arg === "--commercial" || arg === "--all") {
    await buildCommercialPack();
  }
}

main().catch((err) => {
  console.error("Error packaging distribution:", err);
  process.exit(1);
});
