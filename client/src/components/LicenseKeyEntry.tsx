import { useState } from "react";
import { useLocation } from "wouter";
import { X, KeyRound, ArrowRight, Loader2 } from "lucide-react";
import { useSessionStore } from "@/store/useSessionStore";

/*
 * License key entry on the landing page — enter a license key to jump
 * straight into the live beta workspace. No waiting room.
 */

export function LicenseKeyEntry({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const setLicenseKey = useSessionStore((s) => s.setLicenseKey);
  const loadServerSessions = useSessionStore((s) => s.loadServerSessions);
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;

    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/v1/account", {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (!res.ok) {
        setError("License key not found. Double-check it and try again.");
        setChecking(false);
        return;
      }
      // Store the license key for server-session sync
      setLicenseKey(trimmed);
      // Attempt to load any existing server-side sessions
      loadServerSessions();
      navigate("/app");
    } catch {
      setError("Couldn't verify that key right now. Try again in a moment.");
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-28 px-6">
      <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-md hover:bg-muted transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>

        <div className="w-10 h-10 rounded-full bg-teal/10 flex items-center justify-center mb-4">
          <KeyRound className="w-5 h-5 text-teal" />
        </div>
        <h3 className="font-display text-lg font-semibold text-foreground mb-1">
          Enter your license key
        </h3>
        <p className="text-muted-foreground text-sm leading-relaxed mb-5">
          Already pre-ordered? Enter your license key to go straight to the live beta.
        </p>

        <form onSubmit={submit}>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg border border-border text-sm font-mono text-foreground focus:outline-none focus:border-teal transition-colors mb-2"
          />
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <button
            type="submit"
            disabled={!key.trim() || checking}
            className="w-full inline-flex items-center justify-center h-10 rounded-lg text-sm font-medium bg-teal hover:bg-teal-dark disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors mt-2"
          >
            {checking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Enter Live Beta
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
