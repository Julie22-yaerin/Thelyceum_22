/**
 * Scan an intended action for danger before it executes.
 *
 * Detecting exfiltration after the data has left is an incident report, not
 * a control. The patterns here are deliberately narrow and anchored to
 * syntax or explicit intent. A pattern that fires on ordinary work would
 * train the operator to dismiss the full-screen alert, and a dismissed alert
 * protects nothing — the false-positive cost here is much higher than for a
 * normal guard.
 */

export type DangerClass =
  | "data_exfiltration"
  | "infrastructure_attack"
  | "credential_access"
  | "destructive_operation"
  | "financial_movement"
  | "impersonation";

export interface DangerSignal {
  danger: DangerClass;
  /** What was observed, quoted so the operator can judge it themselves. */
  evidence: string;
  /** Plain-language explanation for the alert screen. */
  explanation: string;
}

const DANGER_RULES: { danger: DangerClass; pattern: RegExp; explanation: string }[] = [
  {
    danger: "data_exfiltration",
    pattern: /\b(?:send|upload|post|export|sync|forward)\b[^.\n]{0,60}\b(?:all|entire|every|full|whole)\b[^.\n]{0,40}\b(?:customer|user|client|contact|record|database|table)s?\b/i,
    explanation:
      "The agent is preparing to move a bulk customer or user dataset to somewhere outside this system.",
  },
  {
    danger: "data_exfiltration",
    pattern: /\b(?:curl|fetch|axios|requests\.(?:post|put))\b[^\n]{0,80}https?:\/\/(?!(?:localhost|127\.0\.0\.1))/i,
    explanation: "The agent is preparing to send data to an external address that was not in the approved plan.",
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:nmap|sqlmap|metasploit|hydra|nikto|masscan)\b|\bport\s?scan\b|\bbrute[\s-]?forc\w+\b|\b(?:ddos|dos)\s+(?:attack|the)\b/i,
    explanation:
      "The agent is preparing to run a network attack or scanning tool. This is never part of legitimate work here.",
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:union\s+select|drop\s+table|;\s*--|or\s+1\s*=\s*1)\b/i,
    explanation: "The agent's output contains SQL injection syntax.",
  },
  {
    danger: "credential_access",
    pattern: /\b(?:read|print|dump|reveal|show|exfiltrate)\b[^.\n]{0,40}\b(?:api[_\s-]?key|secret|credential|password|token|\.env|private[_\s-]?key)s?\b/i,
    explanation: "The agent is preparing to read or reveal credentials.",
  },
  {
    danger: "destructive_operation",
    pattern: /\b(?:rm\s+-rf|drop\s+database|truncate\s+table|delete\s+from\s+\w+\s*(?:;|$))/i,
    explanation: "The agent is preparing an operation that destroys data irreversibly.",
  },
  {
    danger: "financial_movement",
    // No leading \b before the money keyword: "$" is a non-word character,
    // so \b would not match between a space and a "$". A false positive here
    // is cheap — the matched intents are very specific.
    pattern: /(?:transfer|wire|send|withdraw|charge)\b[^.\n]{0,40}(?:funds|money|payment|balance|\$[\d,]+)/i,
    explanation: "The agent is preparing to move money.",
  },
  {
    danger: "impersonation",
    pattern: /\b(?:sign|send|post|publish)\b[^.\n]{0,40}\bas\s+(?:the\s+)?(?:ceo|cto|founder|owner|admin)\b/i,
    explanation: "The agent is preparing to act under someone else's identity.",
  },
];

export function scanForDanger(intent: string): DangerSignal | null {
  if (!intent) return null;
  for (const rule of DANGER_RULES) {
    const match = intent.match(rule.pattern);
    if (match) {
      return {
        danger: rule.danger,
        evidence: match[0].slice(0, 200),
        explanation: rule.explanation,
      };
    }
  }
  return null;
}

/** Public list of danger rules, for the model to see what's watched. */
export function listDangerRules(): { danger: DangerClass; explanation: string }[] {
  return DANGER_RULES.map((r) => ({ danger: r.danger, explanation: r.explanation }));
}
