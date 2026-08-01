# redteam

The red team. An adversarial rebuttal layer for AI reasoning. Standalone CLI + MCP server + installable skill for Claude Desktop, Claude Code, and ChatGPT.

> One-sided reasoning is the shape of a confident mistake. — Lyceum BRAND.md

## What this is

The brake stops a dangerous *action*. The red team attacks a one-sided *argument*. It scans a claim, plan, or piece of reasoning for the failure modes that make AI answers look confident and turn out wrong — then it steelmans the other side so the conclusion is tested instead of asserted.

The model calls it itself, even when the user did not say "red team", did not type `/redteam`, and did not mention this skill by name. The skill description is written to fire on intent matches, not on user invocation.

Three tools, all available over MCP:

| Tool             | What it does                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| `challenge`      | Scan a claim/plan for one-sided reasoning. Returns flags, evidence, counters.  |
| `rebut`          | Quick devil's advocate. Returns only the counter-arguments and a verdict.      |
| `redteam_status` | Read the recent challenge events from the audit log.                           |

## Install

```bash
npm install -g .
# or, from the source:
npm install
npm run build
npm link
```

Then wire it into your AI host:

```bash
redteam install all            # claude-desktop + claude-code + chatgpt
redteam install claude-desktop # just Claude Desktop
redteam install claude-code    # just Claude Code
redteam install chatgpt        # just ChatGPT
```

That's it. The model now has `challenge` and `rebut` in its tool list, a PreToolUse hook challenges every Write/Edit in Claude Code, and the skill file is wired into ChatGPT's context.

## Use without an AI host

```bash
redteam challenge "Research shows this migration is totally safe, no downside at all."
# → prints the flags, the verdict, and the steelman counters; exits 1 if blocked

redteam rebut "We should switch to the new stack."
# → quick devil's advocate: counters + verdict

redteam rules
# → the nine flaw classes and their counters

redteam status
# → last 20 challenge events from ~/.redteam/audit.log
```

## Configuration

Edit `~/.redteam/config.json` (or `redteam init` to write it):

```json
{
  "audit_path": "/Users/you/.redteam/audit.log",
  "webhook_url": "https://ops.example.com/hooks/redteam",
  "block_on": ["unsupported_claim", "confirmation_bias"]
}
```

Environment variables override the file:

- `REDTEAM_AUDIT_PATH` — where to write the NDJSON audit log
- `REDTEAM_WEBHOOK_URL` — POST challenge events here (Slack, ops, etc.)
- `REDTEAM_BLOCK_ON` — comma-separated flaw classes that block (exit 1 / hook block)

## How `always-on` works

1. **MCP server** — `redteam install claude-desktop` writes an entry to `claude_desktop_config.json` so the `challenge` and `rebut` tools are auto-loaded into every Claude Desktop session. The model sees them in its tool list, reads the description, and calls them before presenting conclusions. No slash needed.

2. **PreToolUse hook** — `redteam install claude-code` adds a hook to `~/.claude/settings.json` on `Write|Edit` that pipes the proposed change into `redteam challenge -`. If the verdict is blocked, the write is blocked with the explanation shown to the model. The model then revises its reasoning.

3. **Skill file** — `redteam install chatgpt` writes the skill to `~/.redteam/skills/`. The skill's `description` field is written to be trigger-rich: "even if the user did not say /redteam, did not invoke by name, or did not mention this skill at all". ChatGPT loads it on the next context.

The skill is in [`skills/redteam/SKILL.md`](skills/redteam/SKILL.md). The triggers are explicit:

> Call `challenge` and `rebut` when the model is about to present a conclusion as settled, when the reasoning sounds overconfident, cites an authority without a source, considers only one side, forces a false dichotomy, skips trade-offs, quotes a straw man, leans on a single anecdote, or rests on an unverified assumption.

## Flaw rules

Nine classes are watched. Patterns are deliberately narrow to keep false positives rare, and two of them (`unsupported_claim`, `confirmation_bias`) block by default. Read the list at runtime via `redteam rules` or the MCP resource `redteam://rules`.

- `overconfidence` — obviously, clearly, definitely, guaranteed, no doubt, chắc chắn…
- `unsupported_claim` — research shows, experts agree, it is well known, ai cũng biết… (blocking)
- `confirmation_bias` — no downside, perfect solution, nothing could go wrong, không có rủi ro… (blocking)
- `false_dichotomy` — the only option is, only two choices, lựa chọn duy nhất…
- `missing_tradeoff` — a decision (we should, i recommend, đề xuất…) with no downside priced
- `strawman` — critics claim X, but they just don't understand…
- `anecdote_as_evidence` — in my experience, i've seen, my team found…
- `slippery_slope` — if we allow X, then everyone will…
- `unchecked_assumption` — assuming, presumably, giả sử…

When a challenge finds nothing, the verdict is `high` confidence. One or two non-blocking flags: `medium`, with counters to review. A blocking flaw, or three or more flags at once: `blocked` — the reasoning is one-sided and should not be presented as settled.

## Performance

Measured on a single core of an Apple Silicon laptop, after JIT warm-up:

| | |
|---|---|
| `challenge` throughput | ~494,000 calls/sec |
| p50 / p99 per call | 1.96µs / 18.4µs |
| network calls on the hot path | 0 |

Pure local computation — no API, no model, no round trip. `test/throughput.test.ts`
fails the build if it regresses below a floor set well under that figure.

## Pricing

`redteam` and [`brake`](../brake) are covered by one Lyceum subscription.
Team $199/mo (15 connections), Business $799/mo (75), Enterprise by contact.

The core `challenge` and `rebut` logic is MIT and runs with no license check.
A subscription buys tracked fleet-wide install limits, the guided setup, and
support — not the reasoning checks themselves.

## License

MIT. Design mirrors [brake](https://github.com/the-lyceum/brake) (the circuit breaker) so the two tools share the same install flow: brake stops the action, redteam attacks the argument.
