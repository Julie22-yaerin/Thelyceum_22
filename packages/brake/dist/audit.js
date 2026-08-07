/**
 * Append-only NDJSON audit log at ~/.brake/audit.log.
 *
 * Every brake engagement, every danger scan that triggered, every install
 * event is written here with high-precision timestamping, environment details,
 * and calculated token savings.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
export const DEFAULT_AUDIT_PATH = join(homedir(), ".brake", "audit.log");
const mkdirCache = new Set();
function resolveAuditPath(override) {
    return override ? resolve(override) : DEFAULT_AUDIT_PATH;
}
export async function appendAudit(event, pathOverride) {
    const path = resolveAuditPath(pathOverride);
    const dir = dirname(path);
    if (!mkdirCache.has(dir)) {
        await fs.mkdir(dir, { recursive: true });
        mkdirCache.add(dir);
    }
    const now = event.timestamp ?? Date.now();
    const enrichedEvent = {
        ...event,
        timestamp: now,
        timestamp_iso: event.timestamp_iso ?? new Date(now).toISOString(),
        environment: event.environment ?? (process.env.BRAKE_ENVIRONMENT === "cloud" ? "cloud" : "local"),
        cloud_region: event.cloud_region ?? process.env.BRAKE_CLOUD_REGION,
    };
    await fs.appendFile(path, JSON.stringify(enrichedEvent) + "\n", "utf-8");
}
export async function readAudit(limit = 20, pathOverride) {
    const path = resolveAuditPath(pathOverride);
    if (!existsSync(path))
        return [];
    const CHUNK = 64 * 1024;
    const handle = await fs.open(path, "r");
    try {
        const { size } = await handle.stat();
        if (size === 0)
            return [];
        let position = size;
        let carry = "";
        const lines = [];
        while (position > 0 && lines.length <= limit) {
            const readSize = Math.min(CHUNK, position);
            position -= readSize;
            const buf = Buffer.alloc(readSize);
            await handle.read(buf, 0, readSize, position);
            const chunkText = buf.toString("utf-8") + carry;
            const parts = chunkText.split("\n");
            carry = position > 0 ? parts.shift() : "";
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i])
                    lines.push(parts[i]);
            }
        }
        if (carry)
            lines.push(carry);
        return lines.slice(0, limit).map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return { event: "corrupt", timestamp: 0, raw: line };
            }
        });
    }
    finally {
        await handle.close();
    }
}
export async function getBrakeMetrics(pathOverride) {
    const events = await readAudit(1000, pathOverride);
    let blockedEvents = 0;
    let totalTokensSaved = 0;
    let totalDollarsSaved = 0;
    let withinSlaCount = 0;
    let slaTrackedCount = 0;
    for (const ev of events) {
        if (ev.event === "brake_engaged" || ev.event === "danger_blocked" || ev.action_blocked) {
            blockedEvents++;
        }
        if (typeof ev.tokens_saved === "number") {
            totalTokensSaved += ev.tokens_saved;
        }
        if (typeof ev.dollars_saved === "number") {
            totalDollarsSaved += ev.dollars_saved;
        }
        if (typeof ev.within_sla === "boolean") {
            slaTrackedCount++;
            if (ev.within_sla)
                withinSlaCount++;
        }
    }
    const slaCompliancePct = slaTrackedCount > 0 ? parseFloat(((withinSlaCount / slaTrackedCount) * 100).toFixed(2)) : 100.0;
    return {
        totalEvents: events.length,
        blockedEvents,
        totalTokensSaved,
        totalDollarsSaved: parseFloat(totalDollarsSaved.toFixed(4)),
        slaCompliancePct,
        environment: process.env.BRAKE_ENVIRONMENT === "cloud" ? "cloud" : "local",
    };
}
//# sourceMappingURL=audit.js.map