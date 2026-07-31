/**
 * Integration hub — connect external tools as MCP servers, from this web app.
 *
 * The requirement was: never send the user to a desktop app or a CLI to wire up
 * an integration. That is right, and this does it — but with one deliberate
 * refusal.
 *
 * A card here NEVER shows "Connected" unless a connection actually exists.
 * OAuth against Gmail or Slack requires a registered application with that
 * provider and a server-side secret; until those are configured, the honest
 * state is "not set up yet", and the card says exactly what is missing and who
 * has to do it. A green badge that means nothing is the single most corrosive
 * thing a governance product can ship — the entire value proposition is that
 * our status displays are true.
 *
 * So there are three real states, and the UI never blurs them:
 *   unavailable  we have no OAuth app for this provider yet
 *   available    ready to connect; clicking starts the real flow
 *   connected    a live credential exists and was verified
 */

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Cloud,
  KeyRound,
  Link2,
  Loader2,
  Plug,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ConnectionState = "unavailable" | "available" | "connecting" | "connected" | "error";

export interface Integration {
  id: string;
  name: string;
  blurb: string;
  /** How this provider authenticates. Drives which flow the card starts. */
  auth: "oauth" | "api_key";
  state: ConnectionState;
  /** Present when unavailable — what is missing, in the operator's terms. */
  blockedReason?: string;
  /** Scopes this will request. Shown BEFORE connecting, never after. */
  scopes?: string[];
  connectedAs?: string;
  connectedAt?: number;
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
  const [keyEntry, setKeyEntry] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    fetch("/api/v1/integrations", { headers: { Authorization: `Bearer ${licenseKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setIntegrations(d.integrations))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, [licenseKey]);

  const connect = async (int: Integration) => {
    if (int.state === "unavailable") return;

    if (int.auth === "api_key") {
      setKeyEntry(int.id);
      return;
    }

    // OAuth: ask the server for the authorize URL it built (state token,
    // redirect URI and scopes all server-side — the browser never assembles
    // an OAuth URL, because a client-built one can be tampered with).
    setBusy(int.id);
    try {
      const res = await fetch(`/api/v1/integrations/${int.id}/authorize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}` },
      });
      if (!res.ok) return;
      const { authorizeUrl } = await res.json();
      if (authorizeUrl) window.location.href = authorizeUrl;
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
      {integrations.map((int) => {
        const isBusy = busy === int.id;
        return (
          <div
            key={int.id}
            className={cn(
              "rounded-lg border p-3 transition-colors",
              int.state === "connected"
                ? "border-emerald-800/50 bg-emerald-950/20"
                : int.state === "unavailable"
                  ? "border-white/5 bg-white/[0.02]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-lg shrink-0">{ICON[int.id] ?? "🔌"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-[13px] font-medium text-white/90">{int.name}</p>
                  {int.state === "connected" && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                      <Check className="w-2.5 h-2.5" />
                      connected
                    </span>
                  )}
                  {int.state === "unavailable" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">
                      not set up
                    </span>
                  )}
                  {int.state === "error" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">
                      error
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
              ) : int.state === "unavailable" ? (
                <AlertCircle className="w-3.5 h-3.5 text-white/20 shrink-0" />
              ) : (
                <button
                  onClick={() => connect(int)}
                  disabled={isBusy}
                  className="shrink-0 h-7 px-2.5 rounded-md bg-white/10 hover:bg-white/20 text-[12px] text-white/90 transition-colors inline-flex items-center gap-1"
                >
                  {isBusy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : int.auth === "oauth" ? (
                    <Link2 className="w-3 h-3" />
                  ) : (
                    <KeyRound className="w-3 h-3" />
                  )}
                  Connect
                </button>
              )}
            </div>

            {/* Why it can't be connected — named plainly, with the fix. */}
            {int.state === "unavailable" && int.blockedReason && (
              <p className="text-[11px] text-amber-300/70 mt-2 leading-relaxed pl-8">
                {int.blockedReason}
              </p>
            )}

            {/* Scopes shown BEFORE connecting. After the fact is not consent. */}
            {int.state === "available" && int.scopes && int.scopes.length > 0 && (
              <div className="mt-2 pl-8">
                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                  Will request
                </p>
                <div className="flex flex-wrap gap-1">
                  {int.scopes.map((s) => (
                    <span
                      key={s}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/50"
                    >
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
        A card reads "connected" only when a credential exists and was verified against the
        provider. Nothing here shows a status it cannot back up.
      </p>
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
