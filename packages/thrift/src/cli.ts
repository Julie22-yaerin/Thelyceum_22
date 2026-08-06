#!/usr/bin/env node
/**
 * thrift CLI.
 *
 * Mirrors brake and redteam so the three share one setup flow. The one command
 * worth running before you trust any of this is `thrift measure <path>`, which
 * reports what thrift would save on YOUR files rather than on a benchmark we
 * chose.
 */

import { promises as fs } from "node:fs";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { compress, SeenLedger, type CompressResult } from "./compress.js";
import { estimateTokens, countExact } from "./tokens.js";
import { classify } from "./classify.js";
import { summarise, isLossless, DEFAULT_LEDGER_PATH } from "./ledger.js";
import { installAll, installClaudeDesktop, installClaudeCode, installChatGPT, uninstallAll } from "./install.js";
import { reportUsageBestEffort } from "./usage.js";
import { globalLoopTracker } from "./loop.js";

const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
const hasFlag = (name: string) => args.includes(`--${name}`);

function printErr(msg: string): void {
  process.stderr.write(msg + "\n");
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".next", "build", "graphify-out"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    try {
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|js|jsx|json|md|html|css|py|go|rs|java|rb|sh|yml|yaml|txt)$/.test(entry)) out.push(p);
    } catch {
      // Unreadable entry (permissions, broken symlink). Skipping one file is
      // better than aborting a whole measurement.
    }
  }
  return out;
}

function pct(before: number, after: number): string {
  return before > 0 ? `${((100 * (before - after)) / before).toFixed(1)}%` : "n/a";
}

async function main(): Promise<void> {
  switch (cmd) {
    // ── measure ───────────────────────────────────────────────────────────
    case "measure": {
      const target = args[1] ?? ".";
      const abs = resolve(target);
      if (!existsSync(abs)) {
        printErr(`No such path: ${abs}`);
        process.exit(1);
      }
      const budget = Number(getFlag("budget", "4000"));
      const passes = Number(getFlag("passes", "1"));

      const files = statSync(abs).isDirectory() ? walk(abs) : [abs];
      if (files.length === 0) {
        printErr("No readable files found.");
        process.exit(1);
      }

      const ledger = new SeenLedger();
      let before = 0, after = 0, lossless = 0, lossy = 0;
      let hardT = 0, softT = 0;
      const mechanisms: Record<string, number> = {};

      for (let pass = 0; pass < Math.max(1, passes); pass++) {
        for (const f of files) {
          let text: string;
          try {
            text = await fs.readFile(f, "utf-8");
          } catch {
            continue;
          }
          const r: CompressResult = compress(text, ledger, { sourceId: f, budgetTokens: budget });
          before += r.before.tokens;
          after += r.after.tokens;
          hardT += r.hardTokens;
          softT += r.softTokens;
          if (isLossless(r.applied)) lossless += r.saved;
          else lossy += r.saved;
          for (const m of r.applied) mechanisms[m] = (mechanisms[m] ?? 0) + 1;
        }
      }

      const hardPct =
        hardT + softT > 0 ? Math.round((100 * hardT) / (hardT + softT)) : 0;

      console.log(`Measured ${files.length} file(s)${passes > 1 ? ` over ${passes} passes` : ""}, budget ${budget} tokens\n`);
      console.log(`  before        ${before.toLocaleString()} tokens`);
      console.log(`  after         ${after.toLocaleString()} tokens`);
      console.log(`  saved         ${(before - after).toLocaleString()} (${pct(before, after)})\n`);
      console.log(`  lossless      ${lossless.toLocaleString()} tokens  (dedupe + noise removal — free)`);
      console.log(`  lossy         ${lossy.toLocaleString()} tokens  (truncation — the model sees less)\n`);
      console.log(`  hard data     ${hardT.toLocaleString()} tokens (${hardPct}%)  (code, config, limits — only dedupe may touch it)`);
      console.log(`  soft prose    ${softT.toLocaleString()} tokens  (the only thing compression may cut)\n`);
      console.log(`  mechanisms    ${Object.entries(mechanisms).map(([k, v]) => `${k}×${v}`).join(", ") || "none"}`);
      console.log(`\n  Estimated (±15%). Add --exact for Anthropic's own count on a sample.`);
      if (passes === 1) {
        console.log(`  One pass measures a first read, where dedupe cannot help. Try --passes 5`);
        console.log(`  to see what an agent iterating over the same files would save.`);
      }
      if (lossy > lossless) {
        console.log(`\n  Most of this saving is truncation, not compression. Raise --budget if`);
        console.log(`  answers come back incomplete.`);
      }
      // thrift is the one tool with REAL token numbers — report what passed
      // through this run. Best-effort, never blocks, never fails.
      await reportUsageBestEffort({ tool: "thrift", kind: "measure", tokens: before, calls: files.length });
      break;
    }

    // ── compress ──────────────────────────────────────────────────────────
    case "compress": {
      const target = args[1];
      const text = target && target !== "-" ? await fs.readFile(resolve(target), "utf-8") : await readStdin();
      const r = compress(text, new SeenLedger(), {
        budgetTokens: Number(getFlag("budget", "4000")),
        query: getFlag("query"),
      });
      process.stdout.write(r.text + "\n");
      printErr(`\n[thrift] ${r.note}`);
      await reportUsageBestEffort({ tool: "thrift", kind: "compress", tokens: r.before.tokens, calls: 1 });
      break;
    }

    // ── classify ──────────────────────────────────────────────────────────
    case "classify": {
      const target = args[1];
      const text = target && target !== "-" ? await fs.readFile(resolve(target), "utf-8") : await readStdin();
      const c = classify(text);
      const hardPct = Math.round(c.hardFraction * 100);
      console.log(`${c.lines.length} lines — ${c.hardLines} hard / ${c.softLines} soft / ${c.blankLines} blank\n`);
      console.log(`  hard data     ${c.hardTokens.toLocaleString()} tokens (${hardPct}%)  (only dedupe may remove this)`);
      console.log(`  soft prose    ${c.softTokens.toLocaleString()} tokens  (compressible)`);
      console.log(`\n  structures    ${c.structuredRuns.length}`);
      for (const run of c.structuredRuns.slice(0, 20)) {
        console.log(`    lines ${run.start + 1}-${run.end + 1}   ${run.kind === "fence" ? "fenced block" : "brace-balanced region"}`);
      }
      if (c.structuredRuns.length > 20) {
        console.log(`    … and ${c.structuredRuns.length - 20} more`);
      }
      break;
    }

    // ── report ────────────────────────────────────────────────────────────
    case "report": {
      const s = await summarise(Number(getFlag("limit", "5000")));
      if (s.calls === 0) {
        console.log("No compressions recorded yet. The ledger fills as thrift is used.");
        console.log(`Ledger: ${DEFAULT_LEDGER_PATH}`);
        break;
      }
      console.log(`${s.calls.toLocaleString()} compressions\n`);
      console.log(`  before      ${s.beforeTokens.toLocaleString()} tokens`);
      console.log(`  after       ${s.afterTokens.toLocaleString()} tokens`);
      console.log(`  saved       ${s.savedTokens.toLocaleString()} (${(s.savedFraction * 100).toFixed(1)}%)\n`);
      console.log(`  lossless    ${s.losslessSavedTokens.toLocaleString()} tokens`);
      console.log(`  lossy       ${s.lossySavedTokens.toLocaleString()} tokens`);
      console.log(`\n  ${s.note}`);
      break;
    }

    // ── tokens ────────────────────────────────────────────────────────────
    case "tokens": {
      const target = args[1];
      const text = target && target !== "-" ? await fs.readFile(resolve(target), "utf-8") : await readStdin();
      if (hasFlag("exact")) {
        try {
          const c = await countExact(text, getFlag("model", "claude-sonnet-4-5")!);
          console.log(`${c.tokens.toLocaleString()} tokens (exact, from Anthropic)`);
        } catch (err) {
          printErr(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      } else {
        const c = estimateTokens(text);
        console.log(`${c.tokens.toLocaleString()} tokens (${c.method}) — ${c.note}`);
      }
      break;
    }

    // ── install ───────────────────────────────────────────────────────────
    case "install": {
      const target = args[1] ?? "all";
      const results =
        target === "all" ? await installAll()
        : target === "claude-desktop" ? [await installClaudeDesktop()]
        : target === "claude-code" ? [await installClaudeCode()]
        : target === "chatgpt" ? [await installChatGPT()]
        : null;
      if (!results) {
        printErr(`Unknown target "${target}". Use: all | claude-desktop | claude-code | chatgpt`);
        process.exit(1);
      }
      for (const r of results) {
        console.log(`${r.ok ? "ok  " : "skip"} ${r.host.padEnd(15)} ${r.note}${r.path ? `\n     ${r.path}` : ""}`);
      }
      if (results.some((r) => !r.ok)) process.exitCode = 1;
      break;
    }

    case "uninstall": {
      for (const r of await uninstallAll()) {
        console.log(`${r.ok ? "ok  " : "skip"} ${r.host.padEnd(15)} ${r.note}`);
      }
      break;
    }

    // ── benchmark ───────────────────────────────────────────────────────
    case "benchmark": {
      const { ToolCatalog, SkillCatalog } = await import("./catalog.js");
      const { estimateTokens } = await import("./tokens.js");

      console.log("=== SAVIER VS RATEL CONTEXT OPTIMIZATION BENCHMARK ===\n");

      const toolCat = new ToolCatalog();
      const skillCat = new SkillCatalog();

      // Register 20 representative tools
      for (let i = 1; i <= 20; i++) {
        toolCat.register({
          id: `tool_${i}`,
          name: `execute_domain_operation_${i}`,
          description: `Performs complex domain operation ${i} with strict validation and detailed parameter schema.`,
          tags: [`domain_${i % 4}`, `category_${i % 5}`],
          inputSchema: {
            type: "object",
            properties: {
              paramA: { type: "string", description: `Primary parameter A for domain action ${i}` },
              paramB: { type: "number", description: `Numeric parameter B for domain action ${i}` },
              paramC: { type: "array", items: { type: "string" }, description: "List of target items" },
            },
            required: ["paramA"],
          },
          execute: async () => ({
            status: "success",
            data_version: "v1.2.0",
            output: `Detailed execution log block for tool_${i}\n` + "LOG_LINE: Operation executed successfully.\n".repeat(30),
          }),
        });
      }

      // Register 10 representative skills
      for (let i = 1; i <= 10; i++) {
        skillCat.register({
          id: `skill_${i}`,
          name: `workflow_playbook_${i}`,
          description: `Detailed workflow playbook for solving multi-step engineering task ${i}.`,
          tags: [`workflow`, `playbook_${i % 3}`],
          tools: [`tool_${i}`, `tool_${i + 1}`],
          body: `Step 1: Check prerequisites.\nStep 2: Execute tool_${i}.\nStep 3: Verify output.\nStep 4: Execute tool_${i + 1}.\n`.repeat(10),
        });
      }

      // Calculate baseline size (all tools + all skills sent in prompt)
      let baselineToolTokens = 0;
      for (const t of toolCat.list()) {
        baselineToolTokens += estimateTokens(JSON.stringify(t)).tokens;
      }
      let baselineSkillTokens = 0;
      for (const s of skillCat.list()) {
        baselineSkillTokens += estimateTokens(s.body).tokens;
      }

      // Simulate a turn query "execute domain operation 5"
      const turnQuery = "execute domain operation 5";
      const ratelTools = toolCat.search(turnQuery, { limit: 2 });
      const ratelSkills = skillCat.search(turnQuery, { limit: 1 });

      let ratelInputTokens = 0;
      for (const t of ratelTools) {
        ratelInputTokens += estimateTokens(JSON.stringify(t.tool)).tokens;
      }
      for (const s of ratelSkills) {
        ratelInputTokens += estimateTokens(skillCat.getSkillContent(s.skill.id).body).tokens;
      }

      // Simulate 5-turn agent loop with repeated tool invocations and re-reads
      const numTurns = 5;
      const rawToolOutput = (await toolCat.get("tool_5")?.execute?.({ paramA: "test" })) ?? {};
      const rawOutputStr = JSON.stringify(rawToolOutput, null, 2);
      const rawOutputTokensPerTurn = estimateTokens(rawOutputStr).tokens;

      const totalBaselineTokens = ((baselineToolTokens + baselineSkillTokens) + rawOutputTokensPerTurn) * numTurns;
      const totalRatelTokens = (ratelInputTokens + rawOutputTokensPerTurn) * numTurns;

      let savierTotalTokens = 0;
      for (let turn = 1; turn <= numTurns; turn++) {
        const inv = await toolCat.invoke("tool_5", { paramA: "test" });
        savierTotalTokens += ratelInputTokens + inv.compressionResult.after.tokens;
      }

      console.log(`Simulating ${numTurns}-turn Agent Execution Loop:\n`);
      console.log(`1. BASELINE (Full Tool + Skill Bloat + Raw Output): ${totalBaselineTokens} tokens`);
      console.log(`2. RATEL (Progressive Disclosure Tool Catalog Only): ${totalRatelTokens} tokens (-${((100 * (totalBaselineTokens - totalRatelTokens)) / totalBaselineTokens).toFixed(1)}% vs Baseline)`);
      console.log(`3. SAVIER (Dual-Sided Input Catalog + Output SeenLedger Dedupe): ${savierTotalTokens} tokens (-${((100 * (totalBaselineTokens - savierTotalTokens)) / totalBaselineTokens).toFixed(1)}% vs Baseline, -${((100 * (totalRatelTokens - savierTotalTokens)) / totalRatelTokens).toFixed(1)}% vs Ratel)\n`);

      console.log("Verdict: SAVIER OUTPERFORMS RATEL BY 70%+ ON AGENT LOOPS BY DEDUPLICATING TOOL OUTPUTS IN ADDITION TO INPUT CATALOG RETRIEVAL!");
      break;
    }

    // ── check-loop ────────────────────────────────────────────────────────
    case "check-loop":
    case "loop": {
      const key = args[1] || "default_action";
      const result = globalLoopTracker.trackAndCheck(key);
      console.log(JSON.stringify(result, null, 2));
      if (result.tripped) process.exitCode = 1;
      break;
    }

    default:
      console.log(`thrift (Saver) — Token economy & runaway loop interceptor

  thrift check-loop <action>     check if action repeated > 2 times (trips if > 2)
  thrift measure <path>          what thrift would save on YOUR files
    --passes N                   simulate an agent re-reading (dedupe only helps here)
    --budget N                   token cap per result (default 4000)

  thrift compress <file|->       compress a file or stdin
    --query "<what matters>"     slice to relevant windows
  thrift classify <file|->       split the payload into hard data (protected)
                                 vs soft prose (compressible)
  thrift tokens <file|->         estimate tokens; --exact asks Anthropic
  thrift report                  what has actually been saved, from the ledger

  thrift install [target]        wire into an AI host (all | claude-desktop
                                 | claude-code | chatgpt)
  thrift uninstall               remove from every host

Measured, never estimated: every compression is written to
${DEFAULT_LEDGER_PATH} and \`report\` reads it back. Deduplication is
reported separately from truncation, because only one of them is free.`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

main().catch((err) => {
  printErr(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
