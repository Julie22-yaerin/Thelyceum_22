/**
 * Best-effort usage reporting for the budget dashboard.
 *
 * All three tools share one Lyceum subscription, and the session that proves
 * it is written by `brake login` (~/.brake/session.json). redteam has no
 * login of its own — it reuses that session, exactly as it reuses the same
 * license server. Without a session there is nothing to attribute usage to,
 * so the report is skipped entirely.
 *
 * Never blocks and never fails the tool: the caller races this against a
 * short timeout, and every error is swallowed. A usage report is a number on
 * a dashboard, not a checkpoint on the hot path.
 */
export interface UsageReportInput {
    tool: "brake" | "redteam" | "thrift";
    kind: string;
    tokens?: number;
    calls?: number;
}
/**
 * Post one usage report. Resolves when sent or timed out — never rejects
 * with a server problem. Races an internal timeout so a hanging server
 * cannot hang the CLI.
 */
export declare function reportUsageBestEffort(input: UsageReportInput): Promise<void>;
//# sourceMappingURL=usage.d.ts.map