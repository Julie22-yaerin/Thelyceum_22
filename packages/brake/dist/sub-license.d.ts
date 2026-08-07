/**
 * Subscription license gate — client side.
 *
 * Separate file from the beta gate (beta.ts) so a paid subscription key and
 * a time-boxed beta key can coexist without one overwriting the other.
 * Checked first: a customer who paid should never be blocked because a beta
 * key happens to also be sitting on the same machine.
 *
 * Same fail-open policy as the beta gate for network/server failures — the
 * whole point of local-first tools is that a Lyceum outage doesn't stop
 * someone's agents from running. Only an explicit "no" (invalid/expired)
 * blocks.
 */
export interface SubLicenseGateResult {
    /** False when no subscription key is installed at all. */
    active: boolean;
    allowed: boolean;
    message?: string;
}
export declare function checkSubLicenseGate(): Promise<SubLicenseGateResult>;
//# sourceMappingURL=sub-license.d.ts.map