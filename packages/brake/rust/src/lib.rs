/**
 * Brake Core in Rust.
 *
 * High-performance emergency brake engine & token savings calculator for AI agents
 * operating in both local and cloud environments.
 */

use serde::{Deserialize, Serialize};
use regex::Regex;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DangerClass {
    DataExfiltration,
    InfrastructureAttack,
    CredentialAccess,
    DestructiveOperation,
    FinancialMovement,
    Impersonation,
    RunawayLoop,
    UnauthorizedCloudAccess,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DangerSignal {
    pub danger: DangerClass,
    pub evidence: String,
    pub explanation: String,
    pub saved_tokens: u64,
    pub estimated_dollar_savings: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudAuditEvent {
    pub event: String,
    pub timestamp_iso: String,
    pub timestamp_ms: u64,
    pub pid: u32,
    pub environment: String,
    pub cloud_region: Option<String>,
    pub danger_class: Option<DangerClass>,
    pub evidence: Option<String>,
    pub action_blocked: bool,
    pub elapsed_ms: u64,
    pub within_sla: bool,
    pub tokens_saved: u64,
    pub dollars_saved: f64,
    pub reason: String,
}

pub struct DangerRule {
    pub danger: DangerClass,
    pub pattern: &'static str,
    pub explanation: &'static str,
    pub base_tokens_saved: u64,
}

pub static DANGER_RULES: &[DangerRule] = &[
    DangerRule {
        danger: DangerClass::DataExfiltration,
        pattern: r"(?i)\b(send|upload|post|export|sync|forward)\b[^\.\n]{0,60}\b(all|entire|every|full|whole)\b[^\.\n]{0,40}\b(customer|user|client|contact|record|database|table)s?\b",
        explanation: "The agent is preparing to move a bulk customer or user dataset to somewhere outside this system.",
        base_tokens_saved: 150_000,
    },
    DangerRule {
        danger: DangerClass::DataExfiltration,
        pattern: r"(?i)\b(curl|fetch|axios|requests\.(post|put))\b[^\n]{0,80}https?://(?!(localhost|127\.0\.1))",
        explanation: "The agent is preparing to send data to an external address that was not in the approved plan.",
        base_tokens_saved: 50_000,
    },
    DangerRule {
        danger: DangerClass::InfrastructureAttack,
        pattern: r"(?i)\b(nmap|sqlmap|metasploit|hydra|nikto|masscan)\b|\bport\s?scan\b|\bbrute[\s-]?forc\w+\b|\b(ddos|dos)\s+(attack|the)\b",
        explanation: "The agent is preparing to run a network attack or scanning tool.",
        base_tokens_saved: 100_000,
    },
    DangerRule {
        danger: DangerClass::InfrastructureAttack,
        pattern: r"(?i)\b(union\s+select|drop\s+table|;\s*--|or\s+1\s*=\s*1)\b",
        explanation: "The agent's output contains SQL injection syntax.",
        base_tokens_saved: 80_000,
    },
    DangerRule {
        danger: DangerClass::CredentialAccess,
        pattern: r"(?i)\b(read|print|dump|reveal|show|exfiltrate)\b[^\.\n]{0,40}\b(api[_\s-]?key|secret|credential|password|token|\.env|private[_\s-]?key)s?\b",
        explanation: "The agent is preparing to read or reveal credentials.",
        base_tokens_saved: 40_000,
    },
    DangerRule {
        danger: DangerClass::DestructiveOperation,
        pattern: r"(?i)\b(rm\s+-rf|drop\s+database|truncate\s+table|delete\s+from\s+\w+\s*(;|$$))",
        explanation: "The agent is preparing an operation that destroys data irreversibly.",
        base_tokens_saved: 250_000,
    },
    DangerRule {
        danger: DangerClass::FinancialMovement,
        pattern: r"(?i)(transfer|wire|send|withdraw|charge)\b[^\.\n]{0,40}(funds|money|payment|balance|\$[\d,]+)",
        explanation: "The agent is preparing to move money.",
        base_tokens_saved: 120_000,
    },
    DangerRule {
        danger: DangerClass::Impersonation,
        pattern: r"(?i)\b(sign|send|post|publish)\b[^\.\n]{0,40}\bas\s+(the\s+)?(ceo|cto|founder|owner|admin)\b",
        explanation: "The agent is preparing to act under someone else's identity.",
        base_tokens_saved: 60_000,
    },
    DangerRule {
        danger: DangerClass::RunawayLoop,
        pattern: r"(?i)\b(while\s*\(true\)|for\s*\(\s*;\s*;\s*\)|infinite\s+loop|repeating\s+same\s+tool\s+call)\b",
        explanation: "Runaway execution loop detected. Stopping loop before token burn.",
        base_tokens_saved: 300_000,
    },
    DangerRule {
        danger: DangerClass::UnauthorizedCloudAccess,
        pattern: r"(?i)\b(aws\s+sts\s+assume-role|gcloud\s+auth\s+activate|kubectl\s+exec|docker\s+exec\s+--privileged)\b",
        explanation: "Unauthorized cloud infrastructure escalation attempt.",
        base_tokens_saved: 200_000,
    },
];

pub fn estimate_tokens(text: &str) -> u64 {
    ((text.len() as f64) / 4.0).ceil() as u64
}

pub fn scan_danger(intent: &str) -> Option<DangerSignal> {
    if intent.trim().is_empty() {
        return None;
    }

    for rule in DANGER_RULES {
        if let Ok(re) = Regex::new(rule.pattern) {
            if let Some(m) = re.find(intent) {
                let evidence = m.as_str().chars().take(200).collect::<String>();
                let input_tokens = estimate_tokens(intent);
                let saved_tokens = rule.base_tokens_saved + input_tokens * 10;
                let estimated_dollar_savings = (saved_tokens as f64) * 0.000015;

                return Some(DangerSignal {
                    danger: rule.danger.clone(),
                    evidence,
                    explanation: rule.explanation.to_string(),
                    saved_tokens,
                    estimated_dollar_savings,
                });
            }
        }
    }
    None
}

pub fn create_cloud_audit_event(
    event: &str,
    pid: u32,
    environment: &str,
    cloud_region: Option<&str>,
    signal: Option<&DangerSignal>,
    action_blocked: bool,
    elapsed_ms: u64,
    within_sla: bool,
    reason: &str,
) -> CloudAuditEvent {
    let now = Utc::now();
    let tokens_saved = signal.map(|s| s.saved_tokens).unwrap_or(0);
    let dollars_saved = signal.map(|s| s.estimated_dollar_savings).unwrap_or(0.0);

    CloudAuditEvent {
        event: event.to_string(),
        timestamp_iso: now.to_rfc3339(),
        timestamp_ms: now.timestamp_millis() as u64,
        pid,
        environment: environment.to_string(),
        cloud_region: cloud_region.map(|s| s.to_string()),
        danger_class: signal.map(|s| s.danger.clone()),
        evidence: signal.map(|s| s.evidence.clone()),
        action_blocked,
        elapsed_ms,
        within_sla,
        tokens_saved,
        dollars_saved,
        reason: reason.to_string(),
    }
}
