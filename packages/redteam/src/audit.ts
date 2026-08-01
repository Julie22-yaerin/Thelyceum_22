/**
 * Append-only NDJSON audit log at ~/.redteam/audit.log.
 *
 * Every challenge that flagged something, every install event, every mode
 * change is written here. The log is the source of truth for "what did the
 * red team actually catch" — the audit trail you can show later, not the
 * in-memory state you can show now.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_AUDIT_PATH = join(homedir(), ".redteam", "audit.log");

export interface AuditEvent {
  event: string;
  timestamp: number;
  [key: string]: unknown;
}

function resolveAuditPath(override?: string): string {
  return override ? resolve(override) : DEFAULT_AUDIT_PATH;
}

export async function appendAudit(event: AuditEvent, pathOverride?: string): Promise<void> {
  const path = resolveAuditPath(pathOverride);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.appendFile(path, JSON.stringify(event) + "\n", "utf-8");
}

/**
 * Read the last `limit` events without loading the whole file.
 *
 * The obvious version — `readFile` the whole log, split, slice the tail —
 * is fine at demo scale and a real problem at the scale this is now priced
 * for: an enterprise fleet with many agents each triggering audit-worthy
 * events accumulates a log that only grows, never rotates, and every
 * `brake_status` / `redteam_status` call would re-read all of it into memory.
 * That is a live cost paid on every status check for the lifetime of the
 * install, and it gets slower every day the fleet runs. Reading backwards
 * from the end in fixed-size chunks keeps both the time and the memory used
 * bounded by `limit`, not by how long the log has existed.
 */
export async function readAudit(limit = 20, pathOverride?: string): Promise<AuditEvent[]> {
  const path = resolveAuditPath(pathOverride);
  if (!existsSync(path)) return [];

  const CHUNK = 64 * 1024;
  const handle = await fs.open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size === 0) return [];

    let position = size;
    let carry = "";
    const lines: string[] = [];

    while (position > 0 && lines.length <= limit) {
      const readSize = Math.min(CHUNK, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      await handle.read(buf, 0, readSize, position);
      const chunkText = buf.toString("utf-8") + carry;
      const parts = chunkText.split("\n");
      // The first part may be a partial line continued by the next chunk
      // read (further back in the file) — hold it as carry rather than
      // treating it as a complete line.
      carry = position > 0 ? parts.shift()! : "";
      for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i]) lines.push(parts[i]);
      }
      if (position > 0 && carry) {
        // will be prefixed onto the next (earlier) chunk on the following
        // loop iteration via `chunkText = buf... + carry` above
      }
    }
    if (carry) lines.push(carry);

    return lines.slice(0, limit).map((line) => {
      try {
        return JSON.parse(line) as AuditEvent;
      } catch {
        return { event: "corrupt", timestamp: 0, raw: line };
      }
    });
  } finally {
    await handle.close();
  }
}
