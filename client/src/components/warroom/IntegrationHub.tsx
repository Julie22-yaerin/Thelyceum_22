/**
 * Integration hub — connect external tools as MCP servers, from this web app.
 *
 * The connect flow is real end-to-end:
 *
 *   1. You see the card ("the shell").
 *   2. Clicking Connect opens a CONSENT MODAL that lists exactly what the
 *      connection may do — in plain language, shown BEFORE anything opens.
 *   3. "Continue" opens the provider's auth page (a real consent URL when the
 *      server has OAuth apps registered; an identical-flow sandbox page
 *      otherwise).
 *   4. After you authorise there, this hub polls and flips the card to
 *      connected. You never leave the workspace for more than a popup.
 *
 * Statuses are honest: "connected" means a connection was completed through
 * the callback, never a guess. The mode badge (Real / Sandbox) states exactly
 * what kind of connection it is, because a governance product that blurs that
 * line is lying about the one thing it sells.
 */

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Cloud,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ConnectionState = "available" | "connecting" | "connected" | "error";

export interface Integration {
  id: string;
  name: string;
  emoji?: string;
  blurb: string;
  /** How this provider authenticates. Drives which flow the card starts. */
  auth: "oauth" | "api_key";
  mode: "real" | "sandbox";
  state: ConnectionState;
  blockedReason?: string;
  /** Scopes this will request. Shown BEFORE connecting, never after. */
  scopes?: string[];
  /** Plain-language labels for each scope, from the server. */
  scopeLabels?: Record<string, string>;
  connectedAs?: string;
  connectedAt?: number;
  connectedMode?: "real" | "sandbox";
  error?: string;
}

const ICON: Record<string, string> = {
  gmail: "✉️",
  slack: "💬",
  notion: "📓",
  github: "🐙",
  gdrive: "📁",
  linear: "📐",
};

export default function IntegrationHub({ licenseKey }: { licenseKey: string }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [consentFor, setConsentFor] = useState<Integration | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [keyEntry, setKeyEntry] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Load the list, and surface a failure instead of rendering an empty one.
   *
   * Swallowing the error here produced the worst possible outcome: a rate-limit
   * lockout or an expired key showed up as "no integrations available", so the
   * operator concluded the product was broken rather than that they needed to
   * wait or re-authenticate. An empty state and a failure state look identical
   * to the user and must never be conflated.
   */
  const load = async () => {
    try {
      const res = await fetch("/api/v1/integrations", {
        headers: { Authorization: `Bearer ${licenseKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError(
          res.status === 429
            ? (body.error as string) ?? "Too many requests — wait a minute and reload."
            : res.status === 401
              ? "Your license key was rejected. Re-enter it to continue."
              : (body.error as string) ?? `Couldn't load integrations (HTTP ${res.status}).`
        );
        return;
      }
      const d = await res.json();
      setLoadError(null);
      setIntegrations(d.integrations);
    } catch {
      setLoadError("Couldn't reach the server. Check your connection and reload.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Surface "cancelled" returns from the sandbox consent page.
    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "cancelled") {
      const provider = params.get("provider");
      setBanner(`${provider ? provider[0].toUpperCase() + provider.slice(1) : "The"} connection was cancelled.`);
      // Clean the URL so a refresh doesn't re-show it.
      window.history.replaceState({}, "", window.location.pathname + window.location.search.replace(/[?&]connect=[^&]*&?/, "&"));
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [licenseKey]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setConnectingId(null);
  };

  /**
   * Poll the list while a connection popup is open; when the callback completes
   * server-side, the card flips to connected and we stop.
   */
  const pollUntilConnected = (id: string) => {
    stopPolling();
    setConnectingId(id);
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 180_000) {
        stopPolling();
        setBanner("The connection is taking longer than expected. The window may have been blocked.");
        return;
      }
      try {
        const res = await fetch("/api/v1/integrations", {
          headers: { Authorization: `Bearer ${licenseKey}` },
        });
        if (!res.ok) return;
        const list = (await res.json()).integrations as Integration[];
        setIntegrations(list);
        const found = list.find((i) => i.id === id);
        if (found?.state === "connected") {
          stopPolling();
          setBanner(`${found.name} connected.`);
        }
      } catch {
        // transient — keep polling
      }
    }, 1500);
  };

  const openConsent = (int: Integration) => {
    if (int.auth === "api_key") {
      setKeyEntry(int.id);
      return;
    }
    setConsentFor(int);
  };

  /** The user approved the scope list — start the actual authorization. */
  const continueToProvider = async () => {
    if (!consentFor) return;
    const int = consentFor;
    setConsentFor(null);
    setBusy(int.id);
    try {
      const res = await fetch(`/api/v1/integrations/${int.id}/authorize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}` },
      });
      if (!res.ok) return;
      const { authorizeUrl } = await res.json();
      if (authorizeUrl) {
        // Open the provider's auth page in a popup; the workspace stays put.
        //
        // `noopener,noreferrer` blocks the opened window from touching
        // `window.opener` — otherwise a compromised provider page could call
        // `window.opener.location = "phishing-site"` and silently redirect
        // the user (reverse tabnabbing). window.open() still returns a
        // usable handle; only `win.opener` is null inside the popup, which
        // is exactly the security guarantee we want.
        const win = window.open(
          authorizeUrl,
          "_blank",
          "noopener,noreferrer,width=520,height=680"
        );
        if (!win) {
          // Popup blocked — fall back to a full-page trip and come back.
          window.location.href = authorizeUrl;
          return;
        }
        pollUntilConnected(int.id);
      }
    } finally {
      setBusy(null);
    }
  };

  const submitKey = async (id: string) => {
    if (!keyValue.trim()) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/v1/integrations/${id}/key`, {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyValue.trim() }),
      });
      if (res.ok) {
        setKeyEntry(null);
        setKeyValue("");
        load();
      }
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/v1/integrations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${licenseKey}` },
      });
      load();
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
        <p className="text-[12px] text-amber-100 mb-2">{loadError}</p>
        <button
          onClick={() => {
            setLoading(true);
            setLoadError(null);
            void load();
          }}
          className="h-7 px-2.5 rounded-md bg-white/10 hover:bg-white/20 text-[12px] text-white/90 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-white/40 py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading integrations…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {banner && (
        <div className="flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2 text-[12px] text-teal-200">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1">{banner}</span>
          <button onClick={() => setBanner(null)} className="text-teal-200/60 hover:text-teal-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {integrations.map((int) => {
        const isBusy = busy === int.id;
        const isConnecting = connectingId === int.id;
        return (
          <div
            key={int.id}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              int.state === "connected"
                ? "border-emerald-800/50 bg-emerald-950/20"
                : isConnecting
                  ? "border-teal-500/40 bg-teal-950/20"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-lg shrink-0">{int.emoji ?? ICON[int.id] ?? "🔌"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[13px] font-medium text-white/90">{int.name}</p>
                  {int.state === "connected" && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                      <Check className="w-2.5 h-2.5" />
                      connected
                    </span>
                  )}
                  {int.state === "connected" && int.connectedMode && (
                    <span
                      className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider",
                        int.connectedMode === "real"
                          ? "bg-white/10 text-white/60"
                          : "bg-amber-500/15 text-amber-300"
                      )}
                    >
                      {int.connectedMode}
                    </span>
                  )}
                  {isConnecting && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      awaiting auth
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/40 truncate">
                  {int.state === "connected" && int.connectedAs
                    ? int.connectedAs
                    : int.error ?? int.blurb}
                </p>
              </div>

              {int.state === "connected" ? (
                <button
                  onClick={() => disconnect(int.id)}
                  disabled={isBusy}
                  className="text-white/30 hover:text-red-400 transition-colors shrink-0"
                  aria-label={`Disconnect ${int.name}`}
                >
                  {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                </button>
              ) : (
                <button
                  onClick={() => openConsent(int)}
                  disabled={isBusy || isConnecting}
                  className="shrink-0 h-7 px-2.5 rounded-md bg-white/10 hover:bg-white/20 text-[12px] text-white/90 transition-colors inline-flex items-center gap-1"
                >
                  {isBusy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : int.auth === "oauth" ? (
                    <Plug className="w-3 h-3" />
                  ) : (
                    <KeyRound className="w-3 h-3" />
                  )}
                  Connect
                </button>
              )}
            </div>

            {/* Scope summary on an available card — the details live in the modal. */}
            {int.state !== "connected" && int.scopes && int.scopes.length > 0 && (
              <div className="mt-2 pl-8">
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  Will request {int.scopes.length} permission{int.scopes.length > 1 ? "s" : ""}
                </p>
                <div className="flex flex-wrap gap-1">
                  {int.scopes.map((s) => (
                    <span key={s} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/50">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {keyEntry === int.id && (
              <div className="mt-3 pl-8 flex gap-2">
                <input
                  type="password"
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitKey(int.id)}
                  placeholder={`${int.name} API key`}
                  autoFocus
                  className="flex-1 h-8 px-2.5 rounded-md bg-black/40 border border-white/10 text-[12px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/30"
                />
                <button
                  onClick={() => submitKey(int.id)}
                  disabled={!keyValue.trim() || isBusy}
                  className="h-8 px-3 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-40 text-[12px] text-white transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setKeyEntry(null);
                    setKeyValue("");
                  }}
                  className="h-8 px-2 text-[12px] text-white/40 hover:text-white/70"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-[10px] text-white/30 leading-relaxed pt-1">
        A card reads "connected" only when a connection was completed through the provider's auth
        flow. Nothing here shows a status it cannot back up.
      </p>

      {/* ── Consent modal ── */}
      {consentFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#121216] shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-white/5">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{consentFor.emoji ?? ICON[consentFor.id] ?? "🔌"}</span>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">
                    Connect {consentFor.name}
                  </h3>
                  <p className="text-[11px] text-white/40">
                    {consentFor.mode === "real" ? "Official OAuth connection" : "Sandbox connection"}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-5">
              <p className="text-[12px] text-white/60 leading-relaxed mb-4">
                {consentFor.name} will be able to do the following with your Lyceum agents.
                You can disconnect any time.
              </p>

              <div className="space-y-2 mb-4">
                {(consentFor.scopes ?? []).map((s) => {
                  const label = consentFor.scopeLabels?.[s] ?? s;
                  return (
                    <div key={s} className="flex items-start gap-2.5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-teal shrink-0 mt-[1px]" />
                      <div className="min-w-0">
                        <p className="text-[12px] text-white/85">{label}</p>
                        <p className="text-[10px] font-mono text-white/35">{s}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {consentFor.mode === "sandbox" && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2.5 mb-4">
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    <strong className="text-amber-100">Sandbox mode.</strong> No {consentFor.name} OAuth
                    app is registered on this server yet, so this walks the real consent flow without
                    touching a live account. The page that opens is this server's consent screen.
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setConsentFor(null)}
                  className="flex-1 h-9 rounded-lg border border-white/10 text-[12px] font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={continueToProvider}
                  disabled={busy === consentFor.id}
                  className="flex-1 h-9 rounded-lg bg-teal hover:bg-teal-dark text-white text-[12px] font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                >
                  {busy === consentFor.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3.5 h-3.5" />
                  )}
                  Continue to {consentFor.name}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bring your own cloud ─────────────────────────────────────────────────────

export interface CloudConfig {
  provider: "aws" | "gcp" | "azure" | "lyceum";
  region?: string;
  /** Verified against the provider, not just stored. */
  verified: boolean;
  verifiedAt?: number;
  error?: string;
}

/**
 * Run the inference and store the data in the customer's own cloud.
 *
 * This is a compliance requirement long before it is a preference: plenty of
 * buyers cannot let prompts containing their data transit a vendor's account at
 * all. Supporting it is what makes the product sellable to them.
 *
 * Credentials are entered here and stored server-side. The UI shows a role ARN
 * or a service-account email — an identifier, never a secret — because a secret
 * rendered back into the DOM is a secret in the browser's memory, the page
 * source, and any screenshot the operator takes.
 */
export function CloudSetup({ licenseKey }: { licenseKey: string }) {
  const [config, setConfig] = useState<CloudConfig | null>(null);
  const [provider, setProvider] = useState<CloudConfig["provider"]>("lyceum");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/cloud", { headers: { Authorization: `Bearer ${licenseKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.config) {
          setConfig(d.config);
          setProvider(d.config.provider);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [licenseKey]);

  const PROVIDERS: { id: CloudConfig["provider"]; name: string; detail: string }[] = [
    { id: "lyceum", name: "Lyceum-hosted", detail: "We run it. Fastest to start." },
    { id: "aws", name: "AWS", detail: "Bedrock + your S3. IAM role, no long-lived keys." },
    { id: "gcp", name: "Google Cloud", detail: "Vertex AI + your GCS. Workload identity." },
    { id: "azure", name: "Azure", detail: "Azure OpenAI + your Blob storage." },
  ];

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-white/40 py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading cloud settings…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {PROVIDERS.map((p) => {
        const active = provider === p.id;
        const isConfigured = config?.provider === p.id && config.verified;
        return (
          <button
            key={p.id}
            onClick={() => setProvider(p.id)}
            className={cn(
              "w-full text-left rounded-lg border p-3 transition-colors",
              active ? "border-white/25 bg-white/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-white/20"
            )}
          >
            <div className="flex items-center gap-2">
              <Cloud className={cn("w-3.5 h-3.5 shrink-0", active ? "text-white/80" : "text-white/30")} />
              <p className="text-[13px] font-medium text-white/90">{p.name}</p>
              {isConfigured && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                  <Check className="w-2.5 h-2.5" />
                  verified
                </span>
              )}
              {active && !isConfigured && p.id !== "lyceum" && (
                <ChevronRight className="w-3.5 h-3.5 text-white/30 ml-auto" />
              )}
            </div>
            <p className="text-[11px] text-white/40 mt-0.5 pl-[22px]">{p.detail}</p>
          </button>
        );
      })}

      {provider !== "lyceum" && !config?.verified && (
        <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
          <p className="text-[11px] text-amber-200/80 leading-relaxed">
            <strong className="text-amber-100">Not connected yet.</strong> Connecting your own cloud
            needs a role or service account created on your side — we will never ask you to paste a
            long-lived root credential. Open cloud setup for the exact policy JSON to apply.
          </p>
        </div>
      )}

      {provider === "lyceum" && (
        <p className="text-[10px] text-white/30 leading-relaxed">
          Your prompts and retrieved documents transit our account. If your compliance position
          rules that out, pick your own cloud instead — that is what it is for.
        </p>
      )}
    </div>
  );
}
