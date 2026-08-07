/**
 * Beta trial gate — client side.
 *
 * Opt-in: if `~/.lyceum/beta-license.json` doesn't exist, every check here
 * is a no-op (`active: false, allowed: true`) and the tool behaves exactly
 * as it does for a normal dev/paid install. The gate only engages for
 * someone who was handed a beta key and ran the activation script.
 *
 * Network/server failure fails OPEN, not closed — this caps an evaluation
 * invite as a courtesy, it is not the payment gate (that's license.ts, which
 * fails closed). A Railway hiccup should never brick a beta reviewer's tools.
 */
export interface BetaGateResult {
    /** False when no beta key is installed at all — the common case outside a beta. */
    active: boolean;
    allowed: boolean;
    message?: string;
}
export declare function checkBetaGate(): Promise<BetaGateResult>;
