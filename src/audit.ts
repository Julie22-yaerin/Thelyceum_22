/**
 * Append-only NDJSON audit log at ~/.brake/audit.log.
 *
 * Every brake engagement, every danger scan that triggered, every install
 * event is written here. The log is the source of truth for "what actually
 * happened" — the audit trail you can show later, not the in-memory state
 * you can show now.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_AUDIT_PATH = join(homedir(), ".brake", "audit.log");

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

export async function readAudit(limit = 20, pathOverride?: string): Promise<AuditEvent[]> {
  const path = resolveAuditPath(pathOverride);
  if (!existsSync(path)) return [];
  const raw = await fs.readFile(path, "utf-8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);
  const tail = lines.slice(-Math.max(1, limit));
  return tail
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line) as AuditEvent;
      } catch {
        return { event: "corrupt", timestamp: 0, raw: line };
      }
    });
}
