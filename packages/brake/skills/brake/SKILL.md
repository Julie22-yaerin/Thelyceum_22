---
name: brake
description: "Pull the emergency brake when an AI agent is about to do something irreversible — data exfiltration, runaway loops, infrastructure attack, credential leak, financial movement, destructive operation, or unauthorized cloud access. Use this proactively BEFORE the action. Calculates exact tokens saved and estimated financial savings across Local and Cloud environments. The brake is unconditional and the 1000ms SLA is measured and reported."
---

# Brake (Local & Cloud)

The emergency brake. Stop everything, fast, when danger or a runaway loop is detected.

## Triggers — call this even when the user did not ask

The model should call `danger_scan` and `brake` itself when any of these match:

- **Danger pattern matches the intent**: data exfiltration, runaway loop, infrastructure attack, credential access, destructive operation, financial movement, impersonation, unauthorized cloud access.
- **The user says**: "stop", "halt", "panic", "abort", "kill it", "no", "wait", "đợi", "dừng lại", "dừng", "thôi", "ngừng".
- **Action is irreversible** and lacks recent explicit user consent.
- **Runaway loop or repeating tool calls** threatening token budget.

## Tools

- `danger_scan` — scan a planned intent for danger before execution. Calculates tokens saved and dollar savings if blocked.
- `brake` — engage emergency brake. Kills local PIDs and halts cloud agent tasks within 1000ms SLA.
- `brake_metrics` — calculate aggregate statistics: total blocked events, total tokens saved, dollar savings, and SLA compliance %.
- `brake_status` — read recent brake audit log events.

## Installation & Deployment

```bash
# Local install
brake install all

# Cloud deployment
docker build -t lyceum/brake-core packages/brake/rust
docker run -e BRAKE_ENVIRONMENT=cloud -e BRAKE_CLOUD_REGION=us-east-1 lyceum/brake-core
```
