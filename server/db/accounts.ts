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
