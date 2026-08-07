/**
 * Combined license gate — checked at the top of every real tool call.
 *
 * Subscription key wins if present: a paying customer is never blocked by a
 * leftover beta key on the same machine. Falls through to the beta gate
 * only when no subscription key is installed. Neither file present at all →
 * unrestricted (the normal dev/local case).
 */
export interface GateResult {
    allowed: boolean;
    message?: string;
}
export declare function checkLicenseGate(): Promise<GateResult>;
//# sourceMappingURL=gate.d.ts.map