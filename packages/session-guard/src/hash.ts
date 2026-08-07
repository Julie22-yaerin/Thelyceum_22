import crypto from "node:crypto";

export interface PasswordHash {
  salt: string;
  hash: string;
  keyLength: number;
}

/**
 * Hash a plain-text password using Scrypt algorithm (N=16384, r=8, p=1).
 */
export function hashPassword(plainText: string): PasswordHash {
  const salt = crypto.randomBytes(16).toString("hex");
  const keyLength = 64;
  const hash = crypto.scryptSync(plainText, salt, keyLength).toString("hex");
  return { salt, hash, keyLength };
}

/**
 * Verify a plain-text password against a stored salt & hash.
 */
export function verifyPassword(plainText: string, stored: PasswordHash): boolean {
  try {
    const computed = crypto.scryptSync(plainText, stored.salt, stored.keyLength).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(stored.hash, "hex"));
  } catch {
    return false;
  }
}
