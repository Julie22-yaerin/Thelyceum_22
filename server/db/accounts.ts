import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./firestore.js";

/**
 * Credits granted per Lemon Squeezy product tier when a license key is
 * provisioned. Matched case-insensitively against the product name Lemon
 * Squeezy sends in the webhook payload — falls back to the Basic amount for
 * anything unrecognized rather than granting zero.
 */
const TIER_CREDITS: Record<string, number> = {
  vip: 2000,
  basic: 500,
};
const DEFAULT_CREDITS = TIER_CREDITS.basic;

export interface Account {
  licenseKey: string;
  email?: string;
  name?: string;
  organization?: string;
  product?: string;
  creditsTotal: number;
  creditsRemaining: number;
  createdAt: number;
  /**
   * Set after a license rotation. The old key still authenticates until
   * `rotationGraceUntil`, so an open War Room tab or a polling worker
   * doesn't get cut off mid-task the moment the operator hits "rotate".
   */
  rotatedFrom?: string;
  rotationGraceUntil?: number;
  rotatedAt?: number;
}

function creditsForProduct(product?: string): number {
  if (!product) return DEFAULT_CREDITS;
  const key = Object.keys(TIER_CREDITS).find((k) => product.toLowerCase().includes(k));
  return key ? TIER_CREDITS[key] : DEFAULT_CREDITS;
}

const collection = () => getDb().collection("accounts");

/**
 * Creates the account on first successful payment, or updates profile
 * fields on a repeat webhook delivery. Idempotent — never resets credits on
 * an existing account.
 */
export async function provisionAccount(params: {
  licenseKey: string;
  email?: string;
  name?: string;
  organization?: string;
  product?: string;
}): Promise<Account> {
  const ref = collection().doc(params.licenseKey);
  const existing = await ref.get();

  if (existing.exists) {
    await ref.set(
      {
        email: params.email,
        name: params.name,
        organization: params.organization,
        product: params.product,
      },
      { merge: true }
    );
    return (await ref.get()).data() as Account;
  }

  const credits = creditsForProduct(params.product);
  const account: Account = {
    licenseKey: params.licenseKey,
    email: params.email,
    name: params.name,
    organization: params.organization,
    product: params.product,
    creditsTotal: credits,
    creditsRemaining: credits,
    createdAt: Date.now(),
  };
  await ref.set(account);
  return account;
}

export async function getAccount(licenseKey: string): Promise<Account | null> {
  const snap = await collection().doc(licenseKey).get();
  return snap.exists ? (snap.data() as Account) : null;
}

/**
 * Issue a new license key for an existing account and mark the old one
 * for a grace window. The old key still authenticates (via the
 * `rotatedFrom` reverse-lookup below) until `graceMs` elapses, then
 * the old doc is deleted.
 *
 * Returns the new key. The new key is shown to the operator exactly
 * once — server logs and the audit trail record the fingerprint only.
 */
export async function rotateLicenseKey(
  oldKey: string,
  graceMs: number
): Promise<{ newKey: string; graceUntil: number } | null> {
  const db = getDb();
  const oldRef = collection().doc(oldKey);
  const existing = await oldRef.get();
  if (!existing.exists) return null;
  const account = existing.data() as Account;

  const newKey = "lyc_" + crypto.randomBytes(24).toString("base64url");
  const graceUntil = Date.now() + graceMs;
  const now = Date.now();

  // Copy the account to the new key, then mark the old doc for grace.
  const newAccount: Account = {
    ...account,
    licenseKey: newKey,
    createdAt: account.createdAt ?? now,
    rotatedFrom: oldKey,
    rotationGraceUntil: undefined,
    rotatedAt: undefined,
  };
  await db.runTransaction(async (tx) => {
    tx.set(collection().doc(newKey), newAccount);
    tx.update(oldRef, {
      rotatedTo: newKey,
      rotatedAt: now,
      rotationGraceUntil: graceUntil,
    });
  });

  return { newKey, graceUntil };
}

/**
 * If a presented key has been rotated, look up the active replacement.
 * Used by authenticateLicenseKey so a still-in-grace old key keeps
 * working for the operator's existing tabs and any workers.
 */
export async function resolveRotatedKey(
  oldKey: string
): Promise<{ account: Account; rotatedFrom: string; graceUntil: number } | null> {
  const snap = await collection().doc(oldKey).get();
  if (!snap.exists) return null;
  const data = snap.data() as Account & { rotatedTo?: string; rotationGraceUntil?: number };
  if (!data.rotatedTo || !data.rotationGraceUntil) return null;
  if (Date.now() > data.rotationGraceUntil) return null;
  const replacement = await getAccount(data.rotatedTo);
  if (!replacement) return null;
  return {
    account: replacement,
    rotatedFrom: oldKey,
    graceUntil: data.rotationGraceUntil,
  };
}

export class InsufficientCreditsError extends Error {
  constructor(public remaining: number, public requested: number) {
    super(`Insufficient credits: have ${remaining}, need ${requested}`);
  }
}

/**
 * Atomically deducts credits, throwing InsufficientCreditsError instead of
 * going negative. Returns the balance remaining after the deduction.
 */
export async function deductCredits(licenseKey: string, amount: number): Promise<number> {
  const db = getDb();
  const ref = collection().doc(licenseKey);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error("Unknown license key");
    }
    const account = snap.data() as Account;
    if (account.creditsRemaining < amount) {
      throw new InsufficientCreditsError(account.creditsRemaining, amount);
    }
    const remaining = account.creditsRemaining - amount;
    tx.update(ref, { creditsRemaining: FieldValue.increment(-amount) });
    return remaining;
  });
}
