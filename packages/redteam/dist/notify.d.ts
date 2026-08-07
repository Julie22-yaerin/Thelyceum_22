/**
 * The default reporting path for a challenge verdict.
 *
 * When the red team flags something, two things should happen so the flag is
 * not invisible: an audit line is written (source of truth) and, if a webhook
 * is configured, an event is posted so external systems (Slack, ops) can see
 * the model's reasoning got challenged. Both are best-effort; a broken
 * webhook must not crash the CLI or the MCP server.
 */
import { type AuditEvent } from "./audit.js";
import type { ChallengeResult } from "./challenge.js";
import type { ResolvedConfig } from "./config.js";
export interface ChallengeEvent extends AuditEvent {
    event: "challenge_flagged";
    timestamp: number;
    blocked: boolean;
    flaws: string[];
    confidence: "high" | "medium" | "low";
    /** The original text, truncated so the log stays readable. */
    text: string;
}
export declare function reportChallenge(cfg: ResolvedConfig, result: ChallengeResult): Promise<void>;
//# sourceMappingURL=notify.d.ts.map