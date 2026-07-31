/**
 * Governance — the human-in-the-loop surface.
 *
 * Two things a non-technical owner needs: the queue of tasks the breaker has
 * paused (Decision Cards), and the base URL to hand their engineer so traffic
 * starts flowing through the proxy at all.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Copy, Check, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";
import { DecisionQueue, type DecisionCardData, type DecisionAction } from "@/components/DecisionCard";
import ThemeToggle from "@/components/ThemeToggle";
import { useSessionStore } from "@/store/useSessionStore";

export default function Governance() {
  const licenseKey = useSessionStore((s) => s.licenseKey);
  const [cards, setCards] = useState<DecisionCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proxyBaseUrl, setProxyBaseUrl] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);

  const auth = licenseKey ? { Authorization: `Bearer ${licenseKey}` } : undefined;

  const load = useCallback(async () => {
    if (!auth) {
      setError("Enter your license key from the homepage first.");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/v1/decisions", { headers: auth });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
        return;
      }
      setCards((await res.json()).cards ?? []);
      setError(null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [licenseKey]);

  useEffect(() => {
    load();
    // Paused agents are time-sensitive — a stale queue means an agent sits
    // blocked longer than it needs to.
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (card: DecisionCardData, action: DecisionAction) => {
    if (!auth) return;
    await fetch(`/api/v1/decisions/${card.breachNodeId}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: action.kind,
        sessionId: card.sessionId,
        grantCents: "grantCents" in action ? action.grantCents : undefined,
        newLimits: action.kind === "modify" ? { grantCents: action.grantCents } : undefined,
      }),
    });
    await load();
  };

  const mintToken = async () => {
    if (!auth) return;
    setMinting(true);
    try {
      const res = await fetch("/api/v1/proxy-tokens", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Default" }),
      });
      if (res.ok) setProxyBaseUrl((await res.json()).baseUrl);
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="min-h-screen bg-ws-subtle">
      <header className="border-b border-ws-border bg-ws-bg">
        <div className="container max-w-3xl h-14 flex items-center justify-between">
          <Link
            href="/missions"
            className="inline-flex items-center gap-1.5 text-sm text-ws-text-soft hover:text-ws-text transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Departments
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 text-sm text-ws-text-soft hover:text-ws-text transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container max-w-3xl py-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-teal" />
          <h1 className="text-xl font-semibold text-ws-text">Needs your decision</h1>
        </div>
        <p className="text-sm text-ws-text-muted mb-6">
          When an agent hits a limit, it stops and waits here. Nothing was sent to the model.
        </p>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 mb-6">
            {error}
          </div>
        ) : null}

        <DecisionQueue cards={cards} onDecide={decide} loading={loading} />

        {/* ── Connect: the zero-touch instruction ── */}
        <section className="mt-10 pt-8 border-t border-ws-border">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-ws-text-muted" />
            <h2 className="text-sm font-semibold text-ws-text">Connect your agents</h2>
          </div>
          <p className="text-[13px] text-ws-text-muted leading-relaxed mb-4">
            Your engineer changes one string — the base URL. No SDK, no wrapper, no code changes.
            Your own provider key keeps being used.
          </p>

          {proxyBaseUrl ? (
            <>
              <div className="relative">
                <pre className="rounded-lg border border-ws-border bg-[#0f0f13] text-[11px] leading-relaxed text-white/90 px-4 py-3 overflow-x-auto">
                  <code>{`const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,   // unchanged
  baseURL: "${proxyBaseUrl}",
});`}</code>
                </pre>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(proxyBaseUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                  aria-label="Copy base URL"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-teal" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-white/60" />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-amber-700 mt-2">
                Copy this now — the full token isn't shown again.
              </p>
            </>
          ) : (
            <button
              onClick={mintToken}
              disabled={minting || !licenseKey}
              className="h-9 px-4 rounded-lg text-[13px] font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors"
            >
              {minting ? "Creating…" : "Create my proxy URL"}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
