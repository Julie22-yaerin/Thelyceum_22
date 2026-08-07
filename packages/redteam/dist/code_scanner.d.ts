/**
 * Code Flaw & Risk Scanner for Red Team.
 *
 * Scans claims, plans, and proposed code edits for:
 *   - WARN / ADVISE: Code heading in the wrong direction, anti-patterns, potential bugs,
 *     type unsafety, resource leaks, or missing error handling. (Does NOT block agent)
 *   - BLOCK: Deterministic crashes, syntax errors, infinite recursion, malicious payloads,
 *     or hardcoded credential leaks. (BLOCKS agent execution)
 */
import { FlawClass, RedFlag } from "./challenge.js";
export interface CodeScanRule {
    flaw: FlawClass;
    severity: "warning" | "blocking";
    explanation: string;
    counter: string;
    advice: string;
    pattern?: RegExp;
    evaluate?: (text: string) => {
        evidence: string;
        detail?: string;
    } | null;
}
export declare const CODE_RULES: CodeScanRule[];
export declare function scanCodeFlaws(text: string): RedFlag[];
//# sourceMappingURL=code_scanner.d.ts.map