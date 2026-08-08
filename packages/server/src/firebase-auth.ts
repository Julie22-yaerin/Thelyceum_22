/**
 * Firebase-backed signup — email/password or Google, verified email required.
 *
 * The client does the actual auth (Firebase's web SDK, config served from
 * /api/firebase-config below) and hands this server an ID token. This
 * module's only job is verifying that token server-side — never trust an
 * unverified token, since anyone can fabricate a JSON blob that merely
 * *looks* like a decoded Firebase user.
 *
 * Verification is a plain JWT signature check against Google's public keys
 * (jose's createRemoteJWKSet, cached and auto-rotated), not the Admin SDK.
 * A Firebase ID token is a standard RS256 JWT — Google documents this exact
 * approach as the supported alternative to the Admin SDK for backends that
 * only need to verify tokens (https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library).
 * The Admin SDK needs a service-account private key because it can also
 * *mint* tokens and manage users server-side; we only ever check a
 * signature someone else already produced, which needs no secret at all —
 * FIREBASE_PROJECT_ID (already public — it's in the client config) is
 * enough to pin the expected issuer/audience.
 *
 * A Google sign-in arrives already email_verified. An email/password signup
 * does not — Firebase sends the verification email itself; the client is
 * expected to force-refresh the ID token and call /complete again once the
 * user has clicked the link. Only a still-valid, email_verified token
 * results in a license.
 *
 * Same reasoning as sub-license's "manual pool, no payment webhook": no
 * license is issued from anything this server can't independently verify
 * — here that's Firebase's own signature, not a client's say-so.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { DbHandle } from "./db.js";
import { autoAssignLicense, SubLicenseError } from "./sub-license.js";
import { resendEmailSender, type EmailSender } from "./email.js";

const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;

export class FirebaseAuthError extends Error {
  constructor(
    public code: "not_configured" | "invalid_token" | "invalid_input" | "pool_exhausted",
    message: string
  ) {
    super(message);
    this.name = "FirebaseAuthError";
  }
}

/** Minimal shape this module actually reads off a decoded token — not the full Firebase type. */
export interface DecodedToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  firebase?: { sign_in_provider?: string };
}

export interface TokenVerifier {
  verifyIdToken(idToken: string): Promise<DecodedToken>;
}

// ── JWT wiring (lazy — only touched if a request actually needs it) ────────

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function getJwtVerifier(): Promise<TokenVerifier> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new FirebaseAuthError("not_configured", "FIREBASE_PROJECT_ID is not set.");

  if (!cachedJwks) cachedJwks = createRemoteJWKSet(new URL(JWKS_URL));

  return {
    async verifyIdToken(idToken: string) {
      const { payload } = await jwtVerify(idToken, cachedJwks!, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        algorithms: ["RS256"],
      });
      if (!payload.sub) throw new Error("token has no subject");
      const firebaseClaim = payload.firebase as { sign_in_provider?: string } | undefined;
      return {
        uid: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
        email_verified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        firebase: firebaseClaim ? { sign_in_provider: firebaseClaim.sign_in_provider } : undefined,
      };
    },
  };
}

// ── Public web config (safe to expose — Firebase's own docs: this is not a secret) ──

const WEB_CONFIG_KEYS = {
  apiKey: "FIREBASE_API_KEY",
  authDomain: "FIREBASE_AUTH_DOMAIN",
  projectId: "FIREBASE_PROJECT_ID",
  storageBucket: "FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID",
  appId: "FIREBASE_APP_ID",
} as const;

export function getPublicWebConfig(): Record<string, string> | null {
  const config: Record<string, string> = {};
  for (const [key, envVar] of Object.entries(WEB_CONFIG_KEYS)) {
    const value = process.env[envVar];
    if (!value) return null;
    config[key] = value;
  }
  return config;
}

// ── Complete signup ──────────────────────────────────────────────────────

export interface CompleteSignupInput {
  idToken: string;
  name: string;
}

export interface CompleteSignupResult {
  verified: boolean;
  licenseKey?: string;
  expiresAt?: number;
}

interface SignupRow {
  uid: string;
  email: string;
  name: string;
  provider: string;
  license_id: string | null;
  created_at: number;
}

export async function completeSignup(
  db: DbHandle,
  input: CompleteSignupInput,
  verifier?: TokenVerifier,
  sender: EmailSender = resendEmailSender
): Promise<CompleteSignupResult> {
  if (!input.idToken) throw new FirebaseAuthError("invalid_input", "idToken is required.");

  const auth = verifier ?? (await getJwtVerifier());
  let decoded: DecodedToken;
  try {
    decoded = await auth.verifyIdToken(input.idToken);
  } catch {
    throw new FirebaseAuthError("invalid_token", "That sign-in token isn't valid or has expired.");
  }
  if (!decoded.email) throw new FirebaseAuthError("invalid_input", "Token has no email.");
  if (!decoded.email_verified) return { verified: false };

  // Idempotent: an account that already has a license (e.g. calling
  // /complete again after a page refresh) gets the SAME one back, never a
  // second pool slot.
  const existing = db.raw.prepare("SELECT * FROM firebase_signups WHERE uid = ?").get(decoded.uid) as
    | SignupRow
    | undefined;
  if (existing?.license_id) {
    const license = db.raw
      .prepare("SELECT license_key, expires_at FROM subscription_licenses WHERE id = ?")
      .get(existing.license_id) as { license_key: string; expires_at: number } | undefined;
    if (license) return { verified: true, licenseKey: license.license_key, expiresAt: license.expires_at };
  }

  const name = input.name.trim() || decoded.name || decoded.email.split("@")[0];
  const provider = decoded.firebase?.sign_in_provider ?? "unknown";

  let license;
  try {
    license = autoAssignLicense(db, `signup:${decoded.email}`, SUBSCRIPTION_MS, "signup");
  } catch (err) {
    if (err instanceof SubLicenseError) throw new FirebaseAuthError("pool_exhausted", err.message);
    throw err;
  }

  if (existing) {
    db.raw.prepare("UPDATE firebase_signups SET license_id = ? WHERE uid = ?").run(license.id, decoded.uid);
  } else {
    db.raw
      .prepare(
        "INSERT INTO firebase_signups (uid, email, name, provider, license_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(decoded.uid, decoded.email, name, provider, license.id, Date.now());
  }

  if (license.expires_at) {
    void sender.sendLicenseEmail(decoded.email, name, license.license_key, license.expires_at);
  }

  return { verified: true, licenseKey: license.license_key, expiresAt: license.expires_at ?? undefined };
}

// ── Admin visibility ─────────────────────────────────────────────────────

export function listFirebaseSignups(db: DbHandle): SignupRow[] {
  return db.raw
    .prepare("SELECT * FROM firebase_signups ORDER BY created_at DESC")
    .all() as unknown as SignupRow[];
}
