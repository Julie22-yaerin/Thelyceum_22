import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { MemoryFirestore } from "./memoryFirestore.js";

let db: Firestore | null = null;
let memory: MemoryFirestore | null = null;
let warned = false;

/**
 * Returns the Firestore client, initialising Firebase Admin lazily from env
 * vars (never from a committed file). Safe to call on every request —
 * `getApps()` guards against re-initialising on warm serverless invocations.
 *
 * When Firebase credentials are absent, this falls back to an in-memory
 * store so the product runs, and can be demoed and tested, with zero setup.
 * That fallback is refused in production: shipping a system of record that
 * silently forgets everything on restart would be far worse than failing
 * loudly at boot.
 */
export function getDb(): Firestore {
  if (db) return db;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const configured = !!(projectId && clientEmail && privateKey);

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Firestore is not configured — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY. " +
          "The in-memory fallback is deliberately disabled in production because it is not durable."
      );
    }
    if (!warned) {
      warned = true;
      console.warn(
        "[Lyceum] No Firebase credentials — using the in-memory store. Data will be lost on restart and is not shared between instances. Set FIREBASE_* to persist."
      );
    }
    memory ??= new MemoryFirestore();
    return memory as unknown as Firestore;
  }

  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }

  db = getFirestore();
  return db;
}

/** True when reads/writes are going to the non-durable in-memory store. */
export function isEphemeralStore(): boolean {
  return memory !== null && db === null;
}
