import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let db: Firestore | null = null;

/**
 * Lazily initializes the Firebase Admin app from env vars (never from a
 * committed file) and returns the Firestore client. Safe to call on every
 * request — `getApps()` guards against re-initializing on warm serverless
 * invocations.
 */
export function getDb(): Firestore {
  if (db) return db;

  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        "Firestore is not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
      );
    }

    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }

  db = getFirestore();
  return db;
}
