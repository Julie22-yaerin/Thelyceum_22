/**
 * Append-only NDJSON audit log at ~/.redteam/audit.log.
 *
 * Every challenge that flagged something, every install event, every mode
 * change is written here. The log is the source of truth for "what did the
 * red team actually catch" — the audit trail you can show later, not the
 * in-memory state you can show now.
 */
export declare const DEFAULT_AUDIT_PATH: string;
export interface AuditEvent {
    event: string;
    timestamp: number;
    [key: string]: unknown;
}
export declare function appendAudit(event: AuditEvent, pathOverride?: string): Promise<void>;
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
export declare function readAudit(limit?: number, pathOverride?: string): Promise<AuditEvent[]>;
//# sourceMappingURL=audit.d.ts.map