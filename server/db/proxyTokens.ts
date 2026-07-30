import crypto from "crypto";
import { getDb } from "./firestore.js";
import type { BreakerPolicy } from "../lib/circuitBreaker.js";
import type { UpstreamName } from "../proxy/llmProxy.js";

/**
 * Proxy tokens — the credential that rides in the proxy base URL.
 *
 * Deliberately NOT the license key. The token appears in a URL path, and URL
 * paths get written to CDN logs, reverse-proxy logs, browser history and error
 * trackers by default. So this is a separate, revocable, rotatable value that
 * grants exactly one capability (route traffic through the proxy under this
 * tenant's policy) and nothing else — losing it can't be used to read the
 * account, the audit graph, or anyone's tasks.
 */

export interface ProxyTokenRecord {
  /** The public token, e.g. lyc_live_9f3a… — safe to put in a base URL. */
  token: string;
  licenseKey: string;
  label: string;
  defaultUpstream: UpstreamName;
  /** Per-tenant overrides on top of DEFAULT_POLICY. */
  policy: Partial<BreakerPolicy>;
  createdAt: number;
  revokedAt?: number;
  lastUsedAt?: number;
}

const collection = () => getDb().collection("proxyTokens");

export function generateProxyToken(): string {
  return `lyc_live_${crypto.randomBytes(18).toString("base64url")}`;
}

export async function mintProxyToken(params: {
  licenseKey: string;
  label?: string;
  defaultUpstream?: UpstreamName;
  policy?: Partial<BreakerPolicy>;
}): Promise<ProxyTokenRecord> {
  const record: ProxyTokenRecord = {
    token: generateProxyToken(),
    licenseKey: params.licenseKey,
    label: params.label ?? "Default",
    defaultUpstream: params.defaultUpstream ?? "openai",
    policy: params.policy ?? {},
    createdAt: Date.now(),
  };
  await collection().doc(record.token).set(record);
  return record;
}

export async function resolveProxyToken(token: string): Promise<ProxyTokenRecord | null> {
  const snap = await collection().doc(token).get();
  if (!snap.exists) return null;
  const record = snap.data() as ProxyTokenRecord;
  if (record.revokedAt) return null;

  // Best-effort liveness stamp; a failure here must not block traffic.
  collection()
    .doc(token)
    .set({ lastUsedAt: Date.now() }, { merge: true })
    .catch(() => {});

  return record;
}

export async function listProxyTokens(licenseKey: string): Promise<ProxyTokenRecord[]> {
  const snap = await collection().where("licenseKey", "==", licenseKey).get();
  return snap.docs
    .map((d) => d.data() as ProxyTokenRecord)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeProxyToken(licenseKey: string, token: string): Promise<boolean> {
  const ref = collection().doc(token);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as ProxyTokenRecord).licenseKey !== licenseKey) return false;
  await ref.set({ revokedAt: Date.now() }, { merge: true });
  return true;
}

export async function updateProxyPolicy(
  licenseKey: string,
  token: string,
  policy: Partial<BreakerPolicy>
): Promise<boolean> {
  const ref = collection().doc(token);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as ProxyTokenRecord).licenseKey !== licenseKey) return false;
  await ref.set({ policy }, { merge: true });
  return true;
}
