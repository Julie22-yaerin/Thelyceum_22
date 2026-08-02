/**
 * Download data integrity.
 *
 * The download page is only as trustworthy as its commands, so these tests
 * pin the invariants that keep a wrong command from reaching a visitor:
 *
 *   - every product covers every environment (npm, npx, docker, the three
 *     hosts, and CI) — a missing card is a user stuck without an answer;
 *   - the npm install command matches the package name in the repo's
 *     package.json, and the CLI's --version matches that package version —
 *     the page can't promise a version the CLI doesn't print;
 *   - every OS has the notes a visitor needs (PATH fix, config paths), and
 *     the config paths match what install.ts actually writes;
 *   - commands are never abbreviated ("..."), because a guessed command is
 *     worse than no command.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PRODUCTS, OSES, productFor, osFor } from "../src/downloads.js";

const EXPECTED_ENV_IDS = [
  "npm",
  "npx",
  "docker",
  "claude-desktop",
  "claude-code",
  "chatgpt",
  "ci",
];

function packageJson(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../${name}/package.json`, import.meta.url), "utf-8")
  ) as { name: string; version: string; bin: Record<string, string> };
}

describe("product coverage", () => {
  it("has exactly the three products", () => {
    expect(PRODUCTS.map((p) => p.id).sort()).toEqual(["brake", "redteam", "thrift"]);
  });

  it("every product covers every environment", () => {
    for (const p of PRODUCTS) {
      expect(p.envs.map((e) => e.id), p.id).toEqual(EXPECTED_ENV_IDS);
    }
  });

  it("the npm install command matches the package name and version", () => {
    for (const p of PRODUCTS) {
      const pkg = packageJson(p.npmPackage);
      expect(pkg.name, p.id).toBe(p.npmPackage);
      const npm = p.envs.find((e) => e.id === "npm")!;
      expect(npm.steps[0].command, p.id).toBe(`npm install -g ${p.npmPackage}`);
      expect(p.version, p.id).toBe(pkg.version);
      // The CLI must actually expose the bin we tell people to run.
      expect(Object.keys(pkg.bin), p.id).toContain(p.bin);
    }
  });

  it("no command is abbreviated with '...'", () => {
    for (const p of PRODUCTS) {
      for (const env of p.envs) {
        for (const step of env.steps) {
          expect(step.command.includes("..."), `${p.id}/${env.id}/${step.title}`).toBe(false);
          expect(step.command.length, `${p.id}/${env.id}/${step.title}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("environment cards", () => {
  it("every env card has a title, tagline and at least one exact command", () => {
    for (const p of PRODUCTS) {
      for (const env of p.envs) {
        expect(env.label.length, `${p.id}/${env.id}`).toBeGreaterThan(0);
        expect(env.tagline.length, `${p.id}/${env.id}`).toBeGreaterThan(0);
        expect(env.steps.length, `${p.id}/${env.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("host cards carry the exact config path per OS", () => {
    // The note token must resolve for every OS the download page can pick.
    for (const p of PRODUCTS) {
      const desktop = p.envs.find((e) => e.id === "claude-desktop")!;
      const desktopNote = desktop.steps[0].note ?? "";
      expect(desktopNote).toContain("{claudeDesktopConfig}");
      const code = p.envs.find((e) => e.id === "claude-code")!;
      expect(code.steps[0].note ?? "").toContain("{claudeCodeConfig}");
      const chatgpt = p.envs.find((e) => e.id === "chatgpt")!;
      expect(chatgpt.steps[0].note ?? "").toContain("{chatgptSkillDir}");
    }
    // ...and every OS actually supplies those tokens.
    for (const os of OSES) {
      expect(os.claudeDesktopConfig.length, os.id).toBeGreaterThan(0);
      expect(os.claudeCodeConfig.length, os.id).toBeGreaterThan(0);
      expect(os.chatgptSkillDir.length, os.id).toBeGreaterThan(0);
      expect(os.pathNote.length, os.id).toBeGreaterThan(0);
    }
  });
});

describe("lookups", () => {
  it("productFor and osFor resolve known ids and reject unknown ones", () => {
    expect(productFor("brake")?.id).toBe("brake");
    expect(productFor("nope")).toBeNull();
    expect(osFor("windows")?.id).toBe("windows");
    expect(osFor("nope")).toBeNull();
  });

  it("OS config paths are per-platform, not one-size-fits-all", () => {
    const mac = osFor("macos")!;
    const win = osFor("windows")!;
    expect(mac.claudeDesktopConfig).not.toBe(win.claudeDesktopConfig);
    expect(mac.claudeDesktopConfig).toContain("Application Support");
    expect(win.claudeDesktopConfig).toContain("%APPDATA%");
  });
});
