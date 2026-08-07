/**
 * The default reporting path for a challenge verdict.
 *
 * When the red team flags something, two things should happen so the flag is
 * not invisible: an audit line is written (source of truth) and, if a webhook
 * is configured, an event is posted so external systems (Slack, ops) can see
 * the model's reasoning got challenged. Both are best-effort; a broken
 * webhook must not crash the CLI or the MCP server.
 */
import { appendAudit } from "./audit.js";
export async function reportChallenge(cfg, result) {
    const event = {
        event: "challenge_flagged",
        timestamp: Date.now(),
        blocked: result.verdict.blocked,
        flaws: result.flags.map((f) => f.flaw),
        confidence: result.verdict.confidence,
        text: result.text.slice(0, 500),
    };
    await appendAudit(event, cfg.auditPath);
    if (cfg.webhookUrl) {
        try {
            const res = await fetch(cfg.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(event),
            });
            await res.text().catch(() => { });
        }
        catch {
            // best effort — the audit line already captured the event
        }
    }
}
//# sourceMappingURL=notify.js.map