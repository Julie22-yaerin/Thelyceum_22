/**
 * Append-only NDJSON audit log at ~/.brake/audit.log.
 *
 * Every brake engagement, every danger scan that triggered, every install
 * event is written here with high-precision timestamping, environment details,
 * and calculated token savings.
 */
export declare const DEFAULT_AUDIT_PATH: string;
export interface AuditEvent {
    event: string;
    timestamp?: number;
    timestamp_iso?: string;
    environment?: "local" | "cloud";
    cloud_region?: string;
    tokens_saved?: number;
    dollars_saved?: number;
    [key: string]: unknown;
}
export interface BrakeMetrics {
    totalEvents: number;
    blockedEvents: number;
    totalTokensSaved: number;
    totalDollarsSaved: number;
    slaCompliancePct: number;
    environment: string;
}
export declare function appendAudit(event: AuditEvent, pathOverride?: string): Promise<void>;
export declare function readAudit(limit?: number, pathOverride?: string): Promise<AuditEvent[]>;
export declare function getBrakeMetrics(pathOverride?: string): Promise<BrakeMetrics>;
//# sourceMappingURL=audit.d.ts.map