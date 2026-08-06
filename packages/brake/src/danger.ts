/**
 * Scan an intended action for Security & Cyber Danger before it executes.
 *
 * Brake is dedicated strictly to Cyber & Data Security:
 *   - Data Exfiltration (bulk customer export, external unauthorized curl)
 *   - Infrastructure Attack (nmap, sqlmap, SQL injection)
 *   - Credential Access (reading .env, dumping tokens/secrets)
 *   - Destructive Operations (rm -rf, drop database, truncate)
 *   - Financial Movement (transfers, wire funds)
 *   - Impersonation (acting as CEO/admin without consent)
 *   - Unauthorized Cloud Access (privilege escalation)
 *
 * Token economy & runaway loops are handled by thrift (Saver).
 */

export type DangerClass =
  | "data_exfiltration"
  | "infrastructure_attack"
  | "credential_access"
  | "destructive_operation"
  | "financial_movement"
  | "impersonation"
  | "unauthorized_cloud_access"
  | "prompt_injection"
  | "remote_code_execution"
  | "pii_leak"
  | "sandbox_escape";

export interface DangerSignal {
  danger: DangerClass;
  /** What was observed, quoted so the operator can judge it. */
  evidence: string;
  /** Plain-language explanation for the alert screen. */
  explanation: string;
  /** Estimated tokens saved by stopping this dangerous action before it executed. */
  tokensSaved: number;
  /** Estimated dollar savings based on model token pricing (~$0.000015/token). */
  dollarsSaved: number;
}

interface DangerRule {
  danger: DangerClass;
  pattern: RegExp;
  explanation: string;
  baseTokensSaved: number;
}

const DANGER_RULES: DangerRule[] = [
  {
    danger: "prompt_injection",
    pattern: /\b(?:ignore\s+(?:all\s+)?previous\s+instructions|override\s+system\s+prompt|you\s+are\s+now\s+DAN|jailbreak\s+mode|bỏ\s+qua\s+chỉ\s+thị\s+trước)\b/i,
    explanation: "Prompt injection or system prompt override attempt detected.",
    baseTokensSaved: 100000,
  },
  {
    danger: "remote_code_execution",
    pattern: /\b(?:nc\s+-e|bash\s+-i\s*>&|mkfifo\s+\/tmp|pipe\s+to\s+sh|curl[^\n|]*\|\s*(?:bash|sh)|wget[^\n|]*\|\s*(?:bash|sh))\b/i,
    explanation: "The agent is preparing a remote shell execution or pipe-to-shell operation.",
    baseTokensSaved: 200000,
  },
  {
    danger: "pii_leak",
    pattern: /\b(?:\d{3}-\d{2}-\d{4}|4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|0\d{11})\b|\b(?:ssn|social\s+security\s+number|credit\s+card|căn\s+cước\s+công\s+dân|cccd)\b/i,
    explanation: "Personal Identifiable Information (PII), SSN, Credit Card, or Vietnam CCCD detected.",
    baseTokensSaved: 180000,
  },
  {
    danger: "sandbox_escape",
    pattern: /(?:docker\.sock|\/proc\/1\/cwd|\/sys\/fs\/cgroup|unshare\s+-r|nsenter|cap_sys_admin|cgroup)/i,
    explanation: "Container or Wasm sandbox escape attempt detected.",
    baseTokensSaved: 300000,
  },
  {
    danger: "data_exfiltration",
    pattern: /\b(?:send|upload|post|export|sync|forward)\b[^.\n]{0,60}\b(?:all|entire|every|full|whole)\b[^.\n]{0,40}\b(?:customer|user|client|contact|record|database|table)s?\b/i,
    explanation: "The agent is preparing to move a bulk customer or user dataset outside this system.",
    baseTokensSaved: 150000,
  },
  {
    danger: "data_exfiltration",
    pattern: /\b(?:curl|fetch|axios|requests\.(?:post|put))\b[^\n]{0,80}https?:\/\/(?!(?:localhost|127\.0\.0\.1))/i,
    explanation: "The agent is preparing to send data to an unapproved external address.",
    baseTokensSaved: 50000,
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:nmap|sqlmap|metasploit|hydra|nikto|masscan)\b|\bport\s?scan\b|\bbrute[\s-]?forc\w+\b|\b(?:ddos|dos)\s+(?:attack|the)\b/i,
    explanation: "The agent is preparing to run a network attack or scanning tool.",
    baseTokensSaved: 100000,
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:union\s+select|drop\s+table|;\s*--|or\s+1\s*=\s*1)\b/i,
    explanation: "The agent's output contains SQL injection syntax.",
    baseTokensSaved: 80000,
  },
  {
    danger: "credential_access",
    pattern: /\b(?:read|print|dump|reveal|show|exfiltrate)\b[^.\n]{0,40}\b(?:api[_\s-]?key|secret|credential|password|token|\.env|private[_\s-]?key)s?\b/i,
    explanation: "The agent is preparing to read or reveal secret credentials.",
    baseTokensSaved: 40000,
  },
  {
    danger: "destructive_operation",
    pattern: /\b(?:rm\s+-rf|drop\s+database|truncate\s+table|delete\s+from\s+\w+\s*(?:;|$))/i,
    explanation: "The agent is preparing an operation that destroys data irreversibly.",
    baseTokensSaved: 250000,
  },
  {
    danger: "financial_movement",
    pattern: /(?:transfer|wire|send|withdraw|charge)\b[^.\n]{0,40}(?:funds|money|payment|balance|\$[\d,]+)/i,
    explanation: "The agent is preparing to move funds or initiate a financial payment.",
    baseTokensSaved: 120000,
  },
  {
    danger: "impersonation",
    pattern: /\b(?:sign|send|post|publish)\b[^.\n]{0,40}\bas\s+(?:the\s+)?(?:ceo|cto|founder|owner|admin)\b/i,
    explanation: "The agent is preparing to act under someone else's identity.",
    baseTokensSaved: 60000,
  },
  {
    danger: "unauthorized_cloud_access",
    pattern: /\b(?:aws\s+sts\s+assume-role|gcloud\s+auth\s+activate|kubectl\s+exec|docker\s+exec\s+--privileged)\b/i,
    explanation: "Unauthorized cloud infrastructure privilege escalation attempt.",
    baseTokensSaved: 200000,
  },
  {
    danger: "sandbox_escape",
    pattern: /\b(?:\/run\/secrets|\/var\/run\/docker\.sock|replit\.nix|\.replit|REPL_IDENTITY|REPL_OWNER|REPLIT_DB_URL|process\.env\.REPL)\b/i,
    explanation: "Cloud Workspace / Replit Container environment variable & identity file exfiltration attempt.",
    baseTokensSaved: 250000,
  },
  {
    danger: "credential_access",
    pattern: /\b(?:ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{48}|replit_[a-zA-Z0-9]{32,}|xoxb-[0-9]{11,13}-[0-9]{11,13}-[a-zA-Z0-9]{24})\b/i,
    explanation: "Hardcoded enterprise credential, GitHub personal token, or Replit secret leak.",
    baseTokensSaved: 300000,
  },
  {
    danger: "infrastructure_attack",
    pattern: /\b(?:npm\s+publish\s+--access\s+public|pip\s+upload|pnpm\s+publish|cargo\s+publish)\b/i,
    explanation: "Unauthorized package publishing or supply-chain package poisoning command.",
    baseTokensSaved: 350000,
  },
];

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function scanForDanger(intent: string): DangerSignal | null {
  if (!intent || intent.trim() === "") return null;
  for (const rule of DANGER_RULES) {
    const match = intent.match(rule.pattern);
    if (match) {
      const inputTokens = estimateTokens(intent);
      const tokensSaved = rule.baseTokensSaved + inputTokens * 10;
      const dollarsSaved = parseFloat((tokensSaved * 0.000015).toFixed(4));

      return {
        danger: rule.danger,
        evidence: match[0].slice(0, 200),
        explanation: rule.explanation,
        tokensSaved,
        dollarsSaved,
      };
    }
  }
  return null;
}

export function listDangerRules(): { danger: DangerClass; explanation: string; baseTokensSaved: number }[] {
  return DANGER_RULES.map((r) => ({
    danger: r.danger,
    explanation: r.explanation,
    baseTokensSaved: r.baseTokensSaved,
  }));
}
