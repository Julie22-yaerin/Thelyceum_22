/**
 * Combined license gate — checked at the top of every real tool call.
 *
 * Subscription key wins if present: a paying customer is never blocked by a
 * leftover beta key on the same machine. Falls through to the beta gate
 * only when no subscription key is installed. Neither file present at all →
 * unrestricted (the normal dev/local case).
 */

import { checkSubLicenseGate } from "./sub-license.js";
import { checkBetaGate } from "./beta.js";

export interface GateResult {
  allowed: boolean;
  message?: string;
}

export async function checkLicenseGate(): Promise<GateResult> {
  const sub = await checkSubLicenseGate();
  if (sub.active) return sub;
  return checkBetaGate();
}
