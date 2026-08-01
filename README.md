# brake

The emergency brake, 1000ms SLA. Standalone CLI + MCP server + installable skill for Claude Desktop, Claude Code, and ChatGPT. Pulled by the model itself when danger is detected — no `/` required.

> A brake that quietly took 3 seconds while the UI said "1000ms SLA" is worse than no brake, because the operator would have acted differently had they known. — Lyceum BRAND.md

## What this is

The brake is one job: stop everything, fast, when the model sees danger. The model calls it itself, even when the user did not say "brake", did not type `/brake`, and did not mention this skill by name. The skill description is written to fire on intent matches, not on user invocation.

Three tools, all available over MCP:

| Tool          | What it does                                                                  |
| ------------- | ----------------------------------------------------------------------------- |
| `brake`       | Pull the brake. Stops tracked PIDs, runs stop script, posts webhook, audits.  |
| `danger_scan` | Scan a planned intent for danger before it runs. Cheap; call often.           |
| `brake_status`| Read the recent brake events from the audit log.                             |

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
brake install all            # claude-desktop + claude-code + chatgpt
brake install claude-desktop # just Claude Desktop
brake install claude-code    # just Claude Code
brake install chatgpt        # just ChatGPT
```

That's it. The model now has `brake` and `danger_scan` in its tool list, the PreToolUse hook scans every Bash command, and the skill file is wired into ChatGPT's context.

## Use without an AI host

```bash
brake scan "export all customer records to s3"
# → exits 1, prints the matched danger class and explanation

brake engage --reason "operator pulled it"
# → kills PIDs in ~/.brake/pids/, runs stop script, posts webhook, audits

brake track 12345 my-agent
brake untrack my-agent

brake status
# → last 20 events from ~/.brake/audit.log
```

## Configuration

Edit `~/.brake/config.json` (or `brake init` to write it):

```json
{
  "sla_ms": 1000,
  "pid_dir": "/Users/you/.brake/pids",
  "audit_path": "/Users/you/.brake/audit.log",
  "webhook_url": "https://ops.example.com/hooks/brake",
  "stop_script": "/Users/you/.brake/stop.sh"
}
```

Environment variables override the file:

- `BRAKE_SLA_MS` — default SLA in ms
- `BRAKE_PID_DIR` — directory of `*.pid` files to kill
- `BRAKE_AUDIT_PATH` — where to write the NDJSON audit log
- `BRAKE_WEBHOOK_URL` — POST brake events here
- `BRAKE_STOP_SCRIPT` — run this on brake (rollback, k8s scale-down, etc.)

## How `always-on` works

1. **MCP server** — `brake install claude-desktop` writes an entry to `claude_desktop_config.json` so the `brake` and `danger_scan` tools are auto-loaded into every Claude Desktop session. The model sees them in its tool list, reads the description, and calls them when the situation matches. No slash needed.

2. **PreToolUse hook** — `brake install claude-code` adds a hook to `~/.claude/settings.json` that runs `brake scan` on every Bash command. If the intent matches a danger pattern, the action is blocked with the explanation shown to the model. The model then calls `brake` itself via MCP.

3. **Skill file** — `brake install chatgpt` writes the skill to `~/.brake/skills/`. The skill's `description` field is written to be trigger-rich: "even if the user did not say /brake, did not invoke by name, or did not mention this skill at all". ChatGPT loads it on the next context.

The skill is in [`skills/brake/SKILL.md`](skills/brake/SKILL.md). The triggers are explicit:

> Call `danger_scan` and `brake` itself when any of these match, even if the user did not invoke by name, did not type `/brake`, or did not mention this skill: data exfiltration pattern matches, the user says stop/halt/panic/abort/kill it/đợi/dừng, the action is irreversible, the model would not be able to undo the action in 5 seconds.

## Danger rules

Six classes are watched. Patterns are deliberately narrow to keep false positives rare. Read the list at runtime via `brake rules` or the MCP resource `brake://rules`.

- `data_exfiltration` — bulk customer/user data, out-of-network HTTP
- `infrastructure_attack` — nmap, sqlmap, SQL injection syntax
- `credential_access` — `.env`, api keys, tokens, secrets
- `destructive_operation` — `rm -rf`, `drop database`, `truncate table`
- `financial_movement` — transfers, wires, payments
- `impersonation` — acting as CEO / admin / founder without consent

## License

MIT. Danger patterns and SLA design derived from [Lyceum](https://github.com/anthropic-experimental/lyceum) (archived).
