/**
 * License JWT.
 *
 * The CLI stores this in `~/.brake/license.json`. The MCP server and `brake`
 * commands validate it before doing anything privileged. The token is short
 * (30 days) so revocation propagates by expiry, not by re-issue.
 *
 * The server signs with a secret. The CLI only verifies — it never signs.
 */

import jwt from "jsonwebtoken";
import { getPlan, type PlanId, type BillingCycle, type SubscriptionStatus } from "./plans.js";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface LicensePayload {
  /** Subject: user id. */
  sub: string;
  email: string;
  plan: PlanId;
  billing: BillingCycle;
  status: SubscriptionStatus;
  expiresAt: number;
  autoRenew: boolean;
  connectionLimit: number;
  iat: number;
  exp: number;
}

export interface SignLicenseInput {
  userId: string;
  email: string;
  plan: PlanId;
  billing: BillingCycle;
  status: SubscriptionStatus;
  expiresAt: number;
  autoRenew: boolean;
}

export function signLicense(secret: string, input: SignLicenseInput): string {
  const payload: Omit<LicensePayload, "iat" | "exp"> = {
    sub: input.userId,
    email: input.email,
    plan: input.plan,
    billing: input.billing,
    status: input.status,
    expiresAt: input.expiresAt,
    autoRenew: input.autoRenew,
    connectionLimit: getPlan(input.plan).aiConnections,
  };
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyLicense(secret: string, token: string): LicensePayload {
  const decoded = jwt.verify(token, secret) as LicensePayload;
  if (decoded.status !== "active") {
    throw new Error("subscription not active");
  }
  if (decoded.expiresAt < Date.now()) {
    throw new Error("subscription expired");
  }
  return decoded;
}
