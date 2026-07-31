import crypto from "node:crypto";
import type express from "express";
import {
  getAccount,
  resolveRotatedKey,
  type Account,
} from "../db/accounts.js";
import { resolveWorkerToken, touchWorker, type Worker } from "../db/workers.js";

/**
 * Non-reversible fingerprint of a credential, for log lines.
 *
 * Logs must never carry a raw license key — a single screenshot, log
 * dump, or error report then compromises the customer. The salt
 * (LYCEUM_FINGERPRINT_SALT env, already required by the proxy) makes
 * the output non-reversible without an offline attack on the salt.
 */
export function fingerprintCredential(value: string): string {
  const salt = process.env.LYCEUM_FINGERPRINT_SALT ?? "";
  return crypto
    .createHash("sha256")
    .update(`${salt}:${value}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Per-IP failed-auth counter. Stops credential stuffing on
 * /api/v1/* — without it, an attacker can spray license keys
 * freely and learn which ones exist.
 *
 * In-memory: same trade-off as the rate limiter. Single-instance
 * assumed; document the constraint in the deploy doc.
 */
const FAILED_AUTH_BUCKET_MS = 15 * 60_000;
const FAILED_AUTH_THRESHOLD = 20;
const FAILED_AUTH_BLOCK_MS = 60 * 60_000;
const failedAuthByIp = new Map<string, { count: number; resetAt: number; blockedUntil?: number }>();

const authSweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of Array.from(failedAuthByIp)) {
    if (rec.resetAt <= now && (!rec.blockedUntil || rec.blockedUntil <= now)) {
      failedAuthByIp.delete(ip);
    }
  }
}, 60_000);
if (typeof authSweeper.unref === "function") authSweeper.unref();

function recordFailedAuth(ip: string): void {
  const now = Date.now();
  const rec = failedAuthByIp.get(ip) ?? { count: 0, resetAt: now + FAILED_AUTH_BUCKET_MS };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + FAILED_AUTH_BUCKET_MS;
  }
  rec.count += 1;
  if (rec.count >= FAILED_AUTH_THRESHOLD) {
    rec.blockedUntil = now + FAILED_AUTH_BLOCK_MS;
  }
  failedAuthByIp.set(ip, rec);
}

function isAuthBlocked(ip: string): boolean {
  const rec = failedAuthByIp.get(ip);
  return !!rec?.blockedUntil && rec.blockedUntil > Date.now();
}

export { recordFailedAuth, isAuthBlocked };

export interface AuthedRequest extends express.Request {
  lyceumAccount?: Account;
  /**
   * Set when the caller authenticated as a specific AI on the roster rather
   * than as the account owner. Presence of this is what lets the MCP server
   * answer "what work is mine" instead of "what work exists".
   */
  lyceumWorker?: Worker;
}

/**
 * Shared credential for both access channels (REST API and MCP): the Lemon
 * Squeezy license key issued at checkout, sent as `Authorization: Bearer
 * <license key>`. There's no separate account/login system — the license
 * key IS the identity.
 *
 * SECURITY: ADMIN_TOKEN is NOT accepted as a Bearer token here. It used to
 * grant universal access with 999,999 credits, which meant a single .env
 * value (often reused, sometimes leaked in screenshots or error reports)
 * bypassed every tenant limit. Admin endpoints are gated separately by
 * `requireAdmin` in server/index.ts and use their own `x-admin-token`
 * header — that path is the only one ADMIN_TOKEN can authorize.
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

  // Brute-force gate: an IP that has racked up too many failed
  // auth attempts in the last 15 minutes is hard-blocked for an
  // hour. The fingerprint goes into the 401 body so a real user
  // hitting this from a shared corporate NAT can recognise the
  // situation when they call support, but the raw IP is not echoed.
  const clientIp = req.ip ?? "unknown";
  if (isAuthBlocked(clientIp)) {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({
      error: "Too many failed auth attempts from this network. Try again later.",
      requestFingerprint: fingerprintCredential(clientIp),
    });
    return;
  }

  // ── Worker token ───────────────────────────────────────────────────────
  // An AI connected over MCP presents its own token (lyw_…), not the
  // company's license key. It gets the account's permissions plus an
  // identity, so the MCP tools can scope answers to its own steps.
  if (licenseKey.startsWith("lyw_")) {
    const worker = await resolveWorkerToken(licenseKey).catch(() => null);
    if (!worker) {
      res.status(401).json({ error: "Unknown or revoked AI token" });
      return;
    }
    const owner = await getAccount(worker.licenseKey).catch(() => null);
    req.lyceumAccount =
      owner ?? {
        licenseKey: worker.licenseKey,
        product: "Worker",
        creditsTotal: 0,
        creditsRemaining: 0,
        createdAt: worker.createdAt,
      };
    req.lyceumWorker = worker;
    void touchWorker(worker.id);
    next();
    return;
  }

  try {
    let account = await getAccount(licenseKey);
    let presentedRotatedFrom: string | undefined;
    if (!account) {
      // The key may have been rotated. If the old key is still in its
      // grace window, we accept it and surface a `mustRotate` flag so
      // the UI can prompt the operator to update the saved credential.
      const rotated = await resolveRotatedKey(licenseKey).catch(() => null);
      if (rotated) {
        account = rotated.account;
        presentedRotatedFrom = rotated.rotatedFrom;
      }
    }
    if (!account) {
      // Count against the brute-force bucket so a credential-stuffing
      // run doesn't get a free oracle for "is this key valid?".
      recordFailedAuth(clientIp);
      res.status(401).json({ error: "Invalid license key" });
      return;
    }
    req.lyceumAccount = account;
    if (presentedRotatedFrom) {
      // The operator is using a key that's been rotated. Mark the
      // request so the API can return a header telling the UI to
      // show a "your key was rotated, please update" banner.
      (req as AuthedRequest & { _rotatedFrom?: string })._rotatedFrom = presentedRotatedFrom;
    }
    next();
  } catch {
    res.status(503).json({ error: "Account lookup unavailable — Firestore may not be configured" });
  }
}
