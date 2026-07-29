import { getDb } from "./firestore.js";

export interface WaitlistEntry {
  ref: string;
  name: string;
  email: string;
  organization: string;
  createdAt: number;
}

const collection = () => getDb().collection("waitlist");

export async function addToWaitlist(params: {
  ref: string;
  name: string;
  email: string;
  organization: string;
}): Promise<WaitlistEntry> {
  const entry: WaitlistEntry = { ...params, createdAt: Date.now() };
  await collection().doc(params.ref).set(entry);
  return entry;
}

export async function getWaitlistEntry(ref: string): Promise<WaitlistEntry | null> {
  const snap = await collection().doc(ref).get();
  return snap.exists ? (snap.data() as WaitlistEntry) : null;
}

export async function listWaitlist(limit = 50): Promise<WaitlistEntry[]> {
  const snap = await collection()
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as WaitlistEntry);
}
