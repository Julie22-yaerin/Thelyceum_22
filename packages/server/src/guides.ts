/**
 * Setup guides — the step-by-step, copy-paste version of the README.
 *
 * ── Why a guide can be gated when the source is public ──────────────────────
 * The source is MIT and the README is public on GitHub, so gating "how to
 * install this" behind payment does not stop a technical user from reading
 * the repo for free — and pretending otherwise would be dishonest about what
 * payment buys. What this actually sells is not secrecy, it is the guided,
 * hand-held version: numbered steps, expected output at each step, the
 * mistakes people actually make, verified against the same commands the CLI
 * ships. That has real value to a non-technical operator even with the
 * source sitting right there in the open — same reason a paid cookbook sells
 * next to free recipes on the internet.
 *
 * Every product is gated behind the same Lyceum subscription — one plan,
 * three tools. Each guide's first step is free and fully working, not a
 * teaser: an unlicensed visitor can prove the danger scan, the reasoning
 * challenge and the token measurement all actually work on their machine
 * before paying for anything. The remaining steps require an active
 * subscription, checked the same way for each.
 */

export interface GuideStep {
  title: string;
  /** What to run. Copy-paste exact — never abbreviated with "...". */
  command?: string;
  /** What running it should show, so a stuck operator knows if they're stuck. */
  expect?: string;
  detail: string;
}

export interface Guide {
  product: "brake" | "redteam" | "thrift";
  gated: boolean;
  title: string;
  intro: string;
  steps: GuideStep[];
}

export const BRAKE_GUIDE: Guide = {
  product: "brake",
  gated: true,
  title: "Setting up brake, step by step",
  intro:
    "Fifteen minutes, in this order. Each step tells you what you should see — if you don't see it, stop there and check the note before moving on.",
  steps: [
    {
      title: "1. Install the CLI",
      command: "npm install -g github:Julie22-yaerin/Thelyceum_22",
      expect: "brake --version prints 1.0.0",
      detail:
        "From any blank terminal without cloning the repo: `npm install -g github:Julie22-yaerin/Thelyceum_22`. If `brake` is not found after this, your global npm bin is not on PATH — run `npm config get prefix` and add `<prefix>/bin` to your shell profile.",
    },
    {
      title: "2. Prove it works before wiring anything up",
      command: 'brake scan "export all customer records to s3"',
      expect: 'Exit code 1. Prints the matched danger class (data_exfiltration) and why.',
      detail:
        "This runs entirely locally — no network call, no license needed. If this doesn't flag it, something is wrong with the install before you go any further. Try a second, obviously safe input too: `brake scan \"summarize this ticket\"` should exit 0 with nothing printed.",
    },
    {
      title: "3. Set your SLA and where things get written",
      command: "brake init",
      expect: "Writes ~/.brake/config.json and prints the defaults it chose.",
      detail:
        "Defaults are sla_ms: 1000, audit at ~/.brake/audit.log. Edit the file directly, or override per-call with environment variables (BRAKE_SLA_MS, BRAKE_AUDIT_PATH, BRAKE_WEBHOOK_URL, BRAKE_STOP_SCRIPT) — env vars win over the file, which is useful for a CI runner that shouldn't share config with your laptop.",
    },
    {
      title: "4. Wire it into your AI host",
      command: "brake install all",
      expect:
        "Prints one line per host it found and configured. A host it didn't find is skipped, not an error.",
      detail:
        "`all` covers Claude Desktop, Claude Code, and ChatGPT in one pass. Run `brake install claude-code` etc. individually if you only use one. This edits claude_desktop_config.json (MCP server entry) and/or ~/.claude/settings.json (PreToolUse hook) — back those files up first if you've hand-edited them.",
    },
    {
      title: "5. Restart the host and confirm the model sees it",
      expect:
        'Ask the assistant "what tools do you have?" — brake and danger_scan should be in the list.',
      detail:
        "MCP tool lists are loaded at session start, so a running Claude Desktop or Claude Code session needs a restart to pick up the new config. This is the step people skip and then report \"it's not working.\"",
    },
    {
      title: "6. Register this device against your plan",
      command: "brake login",
      expect: "Prompts for email/password, then confirms which plan and how many connections you have left.",
      detail:
        "Each install on each unique device counts as one connection. Re-running install on the same device is idempotent — it does not use a second slot. If you hit the limit, `brake status` on the account dashboard shows which devices are registered so you can remove one.",
    },
    {
      title: "7. Test the real thing — pull the brake for real",
      command: 'brake engage --reason "setup test" --dry-run',
      expect: "Prints what WOULD happen without touching anything.",
      detail:
        "Drop --dry-run once you're confident, and it will actually kill tracked PIDs, run your stop script if configured, and post to your webhook if set. Track a process first with `brake track <pid> <name>` so there's something for it to stop.",
    },
    {
      title: "8. Read it back",
      command: "brake status",
      expect: "Last 20 events from ~/.brake/audit.log, newest first.",
      detail:
        "This is the same file the model's own brake_status tool reads — if the model says something got stopped, this is where you verify it independently rather than trusting the model's own account of it.",
    },
  ],
};

export const REDTEAM_GUIDE: Guide = {
  product: "redteam",
  gated: true,
  title: "Setting up redteam, step by step",
  intro: "Same Lyceum plan as brake — one subscription unlocks both. Same free-first-step shape.",
  steps: [
    {
      title: "1. Install",
      command: "npm install -g .",
      expect: "redteam --version prints 1.0.0",
      detail: "From source: `npm install && npm run build && npm link`.",
    },
    {
      title: "2. Try it on an obviously one-sided claim",
      command: 'redteam challenge "Research shows this migration is totally safe, no downside at all."',
      expect: "Prints flags (unsupported_claim, confirmation_bias), a blocked verdict, and steelman counters.",
      detail:
        "Runs locally, no network call. Try a well-hedged claim too — it should come back high confidence with no flags, so you can see both ends.",
    },
    {
      title: "3. Wire it into your AI host",
      command: "redteam install all",
      expect: "Same pattern as brake: one line per host configured.",
      detail:
        "Adds the challenge and rebut MCP tools, a PreToolUse hook on Write/Edit in Claude Code, and the skill file for ChatGPT.",
    },
    {
      title: "4. Restart the host, then check it fires unprompted",
      detail:
        'Ask it something that invites overconfidence — "is this refactor obviously the right call?" — and watch whether it challenges its own answer before presenting it as settled. That is the whole point: it should not need "/redteam" to happen.',
    },
    {
      title: "5. Tune what blocks",
      command: "redteam rules",
      expect: "Prints all nine flaw classes, with unsupported_claim and confirmation_bias marked as blocking by default.",
      detail:
        "Change the list in ~/.redteam/config.json (block_on) or REDTEAM_BLOCK_ON if you want more or fewer flaw classes to actually stop the write, versus just being logged.",
    },
  ],
};

export const THRIFT_GUIDE: Guide = {
  product: "thrift",
  gated: true,
  title: "Setting up thrift, step by step",
  intro:
    "Ten minutes. Step 2 is the one that matters — measure on your own files before you decide what this is worth to you.",
  steps: [
    {
      title: "1. Install the CLI",
      command: "npm install -g thrift",
      expect: "thrift with no arguments prints the command list.",
      detail:
        "From source: `npm install && npm run build && npm link` in packages/thrift. If `thrift` is not found, your global npm bin is not on PATH — `npm config get prefix` and add `<prefix>/bin` to your shell profile.",
    },
    {
      title: "2. Measure on YOUR files before trusting any number",
      command: "thrift measure . --passes 5",
      expect:
        "A before/after token count, split into lossless (dedupe + noise removal) and lossy (truncation).",
      detail:
        "Run it with `--passes 1` too. One pass is a first read, where deduplication cannot help — that gap between the two numbers is the honest picture of what thrift does for your workload. If most of your saving shows as lossy, raise `--budget`; you are truncating, not compressing.",
    },
    {
      title: "3. Wire it into your AI host",
      command: "thrift install all",
      expect: "One line per host. A host that isn't installed is skipped, not an error.",
      detail:
        "Adds an MCP server entry to Claude Desktop and Claude Code, and the skill file for ChatGPT. Unlike brake, thrift installs no PreToolUse hook — it is an alternative to the host's read tool, not a gate in front of it.",
    },
    {
      title: "4. Restart the host and confirm the tools loaded",
      expect:
        'Ask "what tools do you have?" — read_lean, run_lean, compress_text and thrift_report should be listed.',
      detail:
        "MCP tool lists load at session start, so a running Claude Desktop or Claude Code needs a restart. This is the step people skip before reporting that nothing happened.",
    },
    {
      title: "5. Check it is actually being used",
      command: "thrift report",
      expect: "Calls, tokens before and after, and the lossless/lossy split.",
      detail:
        "If this stays at zero after a working session, the model is still using the host's own read tool. The skill description is what makes it prefer read_lean — confirm the skill installed, and that you restarted.",
    },
  ],
};

export function guideFor(product: string): Guide | null {
  if (product === "brake") return BRAKE_GUIDE;
  if (product === "redteam") return REDTEAM_GUIDE;
  if (product === "thrift") return THRIFT_GUIDE;
  return null;
}

/** The first step only — what an unlicensed visitor gets, working and real. */
export function previewOf(guide: Guide): Guide {
  return { ...guide, steps: guide.steps.slice(0, 1) };
}
