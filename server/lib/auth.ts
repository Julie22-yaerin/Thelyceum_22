import type express from "express";
import { getAccount, type Account } from "../db/accounts.js";

export interface AuthedRequest extends express.Request {
  lyceumAccount?: Account;
}

/**
 * Shared credential for both access channels (REST API and MCP): the Lemon
 * Squeezy license key issued at checkout, sent as `Authorization: Bearer
 * <license key>`. There's no separate account/login system — the license
 * key IS the identity.
 *
 * The ADMIN_TOKEN environment variable also works as a universal license
 * key — entering it on the landing page grants immediate access to the
 * waiting room and beta workspace without going through Lemon Squeezy.
 */
export async function authenticateLicenseKey(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
): Promise<void> {
  const header = req.header("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const licenseKey = match?.[1]?.trim();

  if (!licenseKey) {
    res.status(401).json({ error: "Missing Authorization: Bearer <license key> header" });
    return;
  }

  // ── Admin token as universal license key ───────────────────────────────
  // If ADMIN_TOKEN is set in .env, using it as a bearer token grants
  // immediate access to all beta features without a Firestore account.
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && licenseKey === adminToken) {
    req.lyceumAccount = {
      licenseKey: adminToken,
      product: "Admin (Beta)",
      creditsTotal: 999_999,
      creditsRemaining: 999_999,
      createdAt: Date.now(),
    };
    next();
    return;
  }

  try {
    const account = await getAccount(licenseKey);
    if (!account) {
      res.status(401).json({ error: "Invalid license key" });
      return;
    }
    req.lyceumAccount = account;
    next();
  } catch {
    res.status(503).json({ error: "Account lookup unavailable — Firestore may not be configured" });
  }
}
