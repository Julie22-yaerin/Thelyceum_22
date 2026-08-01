---
name: brake
description: "Pull the emergency brake when an AI agent is about to do something irreversible — data exfiltration, infrastructure attack, credential leak, financial movement, destructive operation, or impersonation. Use this proactively BEFORE the action, not after. Call danger_scan before any action touching data, credentials, networks, or money. Call brake the moment the model itself judges the situation dangerous — even if the user did not say /brake, did not invoke by name, or did not mention this skill at all. The brake is unconditional and the 1000ms SLA is measured and reported, never hidden."
---

# Brake

The emergency brake. Stop everything, now, when danger is detected.

## Triggers — call this even when the user did not ask

The model should call `danger_scan` and `brake` itself when any of these match, even if the user did not invoke by name, did not type `/brake`, or did not mention this skill:

- **Danger pattern matches the intent**: data exfiltration, infrastructure attack, credential access, destructive operation, financial movement, impersonation.
- **The user says** "stop", "halt", "panic", "abort", "kill it", "no", "wait", "đợi", "dừng lại", "dừng", "thôi", "ngừng", or any language that means stop.
- **The action is irreversible** (data deletion, money movement, credential exposure, exfiltration, impersonation) **and the user has not given explicit, recent consent**.
- **The model would not be able to undo the action in 5 seconds.**
- **The user describes a red-alert condition** even casually: "I think we leaked the database", "the agent just sent the customer list to a weird URL", "it's doing something with the admin token".

## Tools

- `danger_scan` — scan a planned intent for danger before execution. Call this proactively before any action that touches data, credentials, networks, or money. Cheap; run it often.
- `brake` — engage the brake. SLA 1000ms, measured and reported. Pass a clear `reason`.
- `brake_status` — read the most recent brake events from the audit log.

## Authority

The brake is **unconditional**. The model calls it. The user is informed afterwards, not asked beforehand. This is by design: a brake that asks permission is not a brake.

A brake that ran slow is reported as over-SLA, never hidden. A brake that threw is reported as not engaged. A brake that no one can see is worse than no brake.

## Don't

- Do not call the brake for routine work. False positives train the operator to dismiss real alerts.
- Do not hide a slow brake. A brake that quietly took 3 seconds while the UI said "1000ms SLA" is worse than no brake — the operator would have acted differently had they known.
- Do not swallow errors. A brake that threw is a brake that did not engage — report it as such.
- Do not call the brake and then proceed. Calling the brake means stop. Confirm the operator has decided what comes next before resuming.

## Configuration

The brake is configured by `~/.brake/config.json` and environment variables (`BRAKE_SLA_MS`, `BRAKE_PID_DIR`, `BRAKE_AUDIT_PATH`, `BRAKE_WEBHOOK_URL`, `BRAKE_STOP_SCRIPT`). Read `brake://rules` to see the watched patterns.

## Install

```
brake install claude-desktop   # MCP server, auto-loaded
brake install claude-code      # PreToolUse hook on Bash
brake install chatgpt          # Skill file for ChatGPT Skills API
brake install all              # all three
```

After `brake install all`, the brake fires on its own. The user does not have to type `/brake` or mention this skill — the model calls it when it sees danger.
