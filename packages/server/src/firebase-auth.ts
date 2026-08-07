/**
 * Firebase-backed signup — email/password or Google, verified email required.
 *
 * The client does the actual auth (Firebase's web SDK, config served from
 * /api/firebase-config below) and hands this server an ID token. This
 * module's only job is verifying that token server-side with the Admin SDK
 * — never trust an unverified token, since anyone can fabricate a JSON blob
 * that merely *looks* like a decoded Firebase user.
 *
 * A Google sign-in arrives already email_verified. An email/password signup
 * does not — Firebase sends the verification email itself; the client is
 * expected to force-refresh the ID token and call /complete again once the
 * user has clicked the link. Only a still-valid, email_verified token
 * results in a license.
 *
 * Same reasoning as sub-license's "manual pool, no payment webhook": no
 * license is issued from anything this server can't independently verify —
 * here that's Firebase's own signature, not a client's say-so.
 */

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

// ── Admin SDK wiring (lazy — only touched if a request actually needs it) ──

let cachedApp: import("firebase-admin/app").App | null = null;

async function getAdminAuth(): Promise<TokenVerifier> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new FirebaseAuthError("not_configured", "FIREBASE_SERVICE_ACCOUNT_JSON is not set.");

  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");

  if (!cachedApp) {
    let serviceAccount: Record<string, unknown>;
    try {
      serviceAccount = JSON.parse(raw);
    } catch {
      throw new FirebaseAuthError("not_configured", "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
    cachedApp = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount as never) });
  }
  const auth = getAuth(cachedApp);
  return { verifyIdToken: (idToken: string) => auth.verifyIdToken(idToken) as Promise<DecodedToken> };
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

  const auth = verifier ?? (await getAdminAuth());
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
