import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const GUARD_DIR = path.join(os.homedir(), ".session-guard");
const TRIAL_FILE = path.join(GUARD_DIR, "trial.json");

// Internal secret for HMAC signature verification
const SIGNING_SECRET = "lyceum-trial-alias-secret-key-2026";

export interface TrialState {
  id: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  usesCount: number;
  signature: string;
}

export interface TrialValidationResult {
  valid: boolean;
  reason?: string;
  usesRemaining: number;
  daysRemaining: number;
}

function ensureDir(): void {
  if (!fs.existsSync(GUARD_DIR)) {
    fs.mkdirSync(GUARD_DIR, { recursive: true, mode: 0o700 });
  }
}

function computeSignature(payload: { id: string; createdAt: number; expiresAt: number; maxUses: number }): string {
  const dataStr = `${payload.id}:${payload.createdAt}:${payload.expiresAt}:${payload.maxUses}`;
  return crypto.createHmac("sha256", SIGNING_SECRET).update(dataStr).digest("hex").slice(0, 32);
}

/**
 * Generate a new short-term Trial / Demo Alias License.
 * Default: 20 usage executions OR 3 days expiration (whichever comes first).
 */
export function issueTrialLicense(maxUses: number = 20, validDays: number = 3): TrialState {
  ensureDir();
  const id = `trial_${crypto.randomBytes(8).toString("hex")}`;
  const createdAt = Date.now();
  const expiresAt = createdAt + validDays * 24 * 3600 * 1000;

  const signature = computeSignature({ id, createdAt, expiresAt, maxUses });

  const state: TrialState = {
    id,
    createdAt,
    expiresAt,
    maxUses,
    usesCount: 0,
    signature,
  };

  fs.writeFileSync(TRIAL_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  return state;
}

/**
 * Validate and consume 1 trial usage attempt.
 */
export function consumeTrialUsage(): TrialValidationResult {
  if (!fs.existsSync(TRIAL_FILE)) {
    return { valid: false, reason: "No trial license found on system.", usesRemaining: 0, daysRemaining: 0 };
  }

  let state: TrialState;
  try {
    state = JSON.parse(fs.readFileSync(TRIAL_FILE, "utf-8"));
  } catch {
    return { valid: false, reason: "Corrupted trial license state.", usesRemaining: 0, daysRemaining: 0 };
  }

  // 1. Verify HMAC Signature (Tamper resistance)
  const expectedSig = computeSignature(state);
  if (state.signature !== expectedSig) {
    return { valid: false, reason: "Tampered or invalid trial license signature.", usesRemaining: 0, daysRemaining: 0 };
  }

  // 2. Check Expiration Time (e.g. 3 days)
  const now = Date.now();
  if (now >= state.expiresAt) {
    const expiredDays = Math.ceil((now - state.expiresAt) / (24 * 3600 * 1000));
    return { valid: false, reason: `Trial license expired ${expiredDays} day(s) ago.`, usesRemaining: 0, daysRemaining: 0 };
  }

  // 3. Check Usage Quota (e.g. 20 uses)
  if (state.usesCount >= state.maxUses) {
    return { valid: false, reason: `Trial limit reached (${state.maxUses}/${state.maxUses} uses consumed).`, usesRemaining: 0, daysRemaining: 0 };
  }

  // Increment usage count and persist
  state.usesCount += 1;
  fs.writeFileSync(TRIAL_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

  const usesRemaining = state.maxUses - state.usesCount;
  const msRemaining = Math.max(0, state.expiresAt - now);
  const daysRemaining = parseFloat((msRemaining / (24 * 3600 * 1000)).toFixed(1));

  return {
    valid: true,
    usesRemaining,
    daysRemaining,
  };
}

/**
 * Query current trial status without consuming usage.
 */
export function getTrialStatus(): TrialValidationResult {
  if (!fs.existsSync(TRIAL_FILE)) {
    return { valid: false, reason: "No trial license found.", usesRemaining: 0, daysRemaining: 0 };
  }

  try {
    const state: TrialState = JSON.parse(fs.readFileSync(TRIAL_FILE, "utf-8"));
    const expectedSig = computeSignature(state);
    if (state.signature !== expectedSig) {
      return { valid: false, reason: "Tampered trial signature.", usesRemaining: 0, daysRemaining: 0 };
    }

    const now = Date.now();
    if (now >= state.expiresAt) {
      return { valid: false, reason: "Trial expired.", usesRemaining: 0, daysRemaining: 0 };
    }

    const usesRemaining = Math.max(0, state.maxUses - state.usesCount);
    if (usesRemaining <= 0) {
      return { valid: false, reason: "Trial uses exhausted.", usesRemaining: 0, daysRemaining: 0 };
    }

    const msRemaining = Math.max(0, state.expiresAt - now);
    const daysRemaining = parseFloat((msRemaining / (24 * 3600 * 1000)).toFixed(1));

    return { valid: true, usesRemaining, daysRemaining };
  } catch {
    return { valid: false, reason: "Invalid license format.", usesRemaining: 0, daysRemaining: 0 };
  }
}
