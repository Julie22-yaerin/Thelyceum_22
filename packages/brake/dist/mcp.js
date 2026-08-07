#!/usr/bin/env node
/**
 * The brake MCP server.
 *
 * Exposes tools over stdio:
 *   - brake          engage the emergency brake
 *   - danger_scan    scan an intent for danger before it runs
 *   - brake_metrics  calculate aggregated token savings & SLA compliance metrics
 *   - brake_status   read recent brake events from the audit log
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { engageBrake, DEFAULT_POLICY } from "./brake.js";
import { scanForDanger, listDangerRules } from "./danger.js";
import { makeStopAll } from "./stop-all.js";
import { readAudit, getBrakeMetrics } from "./audit.js";
import { loadConfig } from "./config.js";
import { getMode, brakeDescriptionFor, dangerScanDescriptionFor } from "./mode.js";
import { loadLicense } from "./license.js";
import { checkLicenseGate } from "./gate.js";
const mode = await getMode();
const cfg = await loadConfig();
const server = new McpServer({
    name: "brake",
    version: "1.0.0",
});
server.tool("brake", brakeDescriptionFor(mode), {
    reason: z.string().describe("Why the brake was pulled. Logged to the audit trail."),
    sla_ms: z.number().int().min(1).max(60_000).optional()
        .describe("Override the SLA for this call. Default from ~/.brake/config.json (1000)."),
    dry_run: z.boolean().optional()
        .describe("If true, do not actually stop anything; return what would happen."),
}, async ({ reason, sla_ms, dry_run }) => {
    const gate = await checkLicenseGate();
    if (!gate.allowed) {
        return { content: [{ type: "text", text: gate.message ?? "License check failed." }], isError: true };
    }
    const lic = await loadLicense().catch(() => null);
    const policy = sla_ms
        ? { ...DEFAULT_POLICY, brakeSlaMs: sla_ms }
        : { ...DEFAULT_POLICY, brakeSlaMs: cfg.slaMs };
    if (dry_run) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        dryRun: true,
                        reason,
                        policy,
                        pidDir: cfg.pidDir,
                        auditPath: cfg.auditPath,
                        webhookUrl: cfg.webhookUrl ?? null,
                        stopScript: cfg.stopScript ?? null,
                        mode,
                        plan: lic?.plan ?? null,
                    }, null, 2),
                }],
        };
    }
    const result = await engageBrake({
        reason,
        policy,
        stopAll: makeStopAll({
            pidDir: cfg.pidDir,
            auditPath: cfg.auditPath,
            webhookUrl: cfg.webhookUrl,
            stopScript: cfg.stopScript,
        }),
    });
    return {
        content: [{ type: "text", text: JSON.stringify({ ...result, mode, plan: lic?.plan ?? null }, null, 2) }],
    };
});
server.tool("danger_scan", dangerScanDescriptionFor(mode), {
    intent: z.string()
        .describe("What the agent is about to do. Will be scanned for danger patterns."),
}, async ({ intent }) => {
    const gate = await checkLicenseGate();
    if (!gate.allowed) {
        return { content: [{ type: "text", text: gate.message ?? "License check failed." }], isError: true };
    }
    const danger = scanForDanger(intent);
    if (danger) {
        return {
            content: [{ type: "text", text: JSON.stringify({ matched: true, ...danger }, null, 2) }],
            isError: true,
        };
    }
    return {
        content: [{ type: "text", text: JSON.stringify({ danger: false }, null, 2) }],
    };
});
server.tool("brake_metrics", "Calculate aggregate statistics: total blocked events, total tokens saved, estimated dollar savings, and SLA compliance rate across local and cloud environments.", {}, async () => {
    const metrics = await getBrakeMetrics(cfg.auditPath);
    return {
        content: [{ type: "text", text: JSON.stringify(metrics, null, 2) }],
    };
});
server.tool("brake_status", "Read the most recent brake events from the audit log. Shows when the brake was pulled, how long it took, whether SLA was met, tokens saved, and PIDs killed.", {
    limit: z.number().int().min(1).max(200).optional()
        .describe("Max events to return. Default 20."),
}, async ({ limit }) => {
    const events = await readAudit(limit ?? 20, cfg.auditPath);
    return {
        content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
    };
});
server.resource("brake://rules", "The list of danger rules the brake watches for. Read this to see what triggers a red alert.", async () => ({
    contents: [{
            uri: "brake://rules",
            mimeType: "application/json",
            text: JSON.stringify(listDangerRules(), null, 2),
        }],
}));
server.resource("brake://mode", "The current brake mode. 'always' = model auto-fires brake on danger. 'slash' = brake only fires on explicit /brake.", async () => ({
    contents: [{
            uri: "brake://mode",
            mimeType: "application/json",
            text: JSON.stringify({ mode, configPath: "~/.brake/config.json" }, null, 2),
        }],
}));
server.prompt("brake_security_audit", "Audit an intended action or tool execution for cyber security threats, prompt injection, and PII leakage", { intent: z.string().describe("The action plan or command to audit") }, async ({ intent }) => ({
    messages: [{
            role: "user",
            content: { type: "text", text: `[BRAKE SECURITY GUARD AUDIT]: Please evaluate this action plan for cyber threat vectors:\n\n${intent}` },
        }],
}));
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=mcp.js.map