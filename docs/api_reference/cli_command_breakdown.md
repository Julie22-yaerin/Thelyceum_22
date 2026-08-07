# CLI COMMAND & ENVIRONMENT REFERENCE MANUAL

## 1. `brake` CLI Reference

### Commands
- `brake scan "<intent text>"`: Scans planned action for security threats (returns JSON with `danger` signal or null).
- `brake engage [--reason <text>] [--sla <ms>]`: Triggers emergency brake, kills tracked PIDs, audits event.
- `brake metrics`: Shows aggregate telemetry (blocked events, tokens saved, dollars saved, SLA compliance).
- `brake status`: Shows recent brake audit entries.
- `brake track <pid> <label>`: Adds process PID to emergency stop list.

### Environment Variables
- `BRAKE_SLA_MS`: SLA threshold in milliseconds (default: `1000`).
- `BRAKE_ENVIRONMENT`: Mode (`local` or `cloud`).
- `BRAKE_AUDIT_PATH`: Custom path for `audit.log`.

---

## 2. `thrift` CLI Reference

### Commands
- `thrift compress <file | ->`: Slices and compresses a file or `stdin` stream.
  - `--budget <N>`: Maximum token budget (default `4000`).
  - `--query "<what matters>"`: Keeps lines relevant to query.
- `thrift measure <path>`: Simulates savings across file tree without modifying files.
- `thrift check-loop <action>`: Triggers alert if an action is repeated $> 2$ times consecutively.
- `thrift report`: Reads and displays total token savings from `ledger.log`.

---

## 3. `session-guard` CLI Reference

### Commands
- `session-guard init`: Prompts user to set master password on first run.
- `session-guard login`: Prompts for password and issues 8-hour session token.
- `session-guard status`: Displays initialization state and active session validity.
- `session-guard lock`: Revokes and deletes active session token.
