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
export type DangerClass = "data_exfiltration" | "infrastructure_attack" | "credential_access" | "destructive_operation" | "financial_movement" | "impersonation" | "unauthorized_cloud_access" | "prompt_injection" | "remote_code_execution" | "pii_leak" | "sandbox_escape";
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
export declare function estimateTokens(text: string): number;
export declare function scanForDanger(intent: string): DangerSignal | null;
export declare function listDangerRules(): {
    danger: DangerClass;
    explanation: string;
    baseTokensSaved: number;
}[];
//# sourceMappingURL=danger.d.ts.map