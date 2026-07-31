"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageCircle,
  X,
  ChevronUp,
  MessageSquarePlus,
  Bug,
  Lightbulb,
  Send,
  CheckCircle2,
  Loader2,
} from "lucide-react";

/* ── Environment ──────────────────────────────────────────────────────────── */

const SLACK_URL = import.meta.env.VITE_SLACK_INVITE_URL || "";

/* ── Feedback Form ─────────────────────────────────────────────────────────── */

type FeedbackView = "closed" | "menu" | "form" | "thanks";

function FeedbackForm({ onBack, onSent }: { onBack: () => void; onSent: () => void }) {
  const [type, setType] = useState<"bug" | "feature">("bug");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);

    // Best-effort: POST to a lightweight endpoint, or fall back silently
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message, url: window.location.href, timestamp: Date.now() }),
      });
    } catch {
      // No server endpoint? That's fine — we still show the thank-you.
      // In production, wire this to Slack webhook, GitHub issue, email, etc.
    }

    setSending(false);
    onSent();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.9 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="bg-white dark:bg-card border border-border rounded-2xl shadow-xl p-3 w-[280px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button onClick={onBack} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1">
          &larr; Back
        </button>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Feedback</p>
        <div className="w-8" />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Type toggle */}
        <div className="flex gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => setType("bug")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
              type === "bug"
                ? "bg-red-50 text-red-600 border border-red-200"
                : "bg-muted/30 text-muted-foreground border border-transparent hover:border-border"
            }`}
          >
            <Bug className="w-3 h-3" />
            Bug
          </button>
          <button
            type="button"
            onClick={() => setType("feature")}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
              type === "feature"
                ? "bg-amber-50 text-amber-600 border border-amber-200"
                : "bg-muted/30 text-muted-foreground border border-transparent hover:border-border"
            }`}
          >
            <Lightbulb className="w-3 h-3" />
            Idea
          </button>
        </div>

        {/* Message */}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={type === "bug" ? "What went wrong? Steps to reproduce..." : "What would make this better?"}
          rows={3}
          className="w-full text-[11px] px-2.5 py-2 rounded-lg border border-border bg-muted/20 resize-none focus:outline-none focus:border-teal transition-colors placeholder:text-muted-foreground/50"
          autoFocus
        />

        {/* Submit */}
        <button
          type="submit"
          disabled={!message.trim() || sending}
          className="w-full mt-2 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-medium bg-teal hover:bg-teal-dark disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all active:scale-[0.98]"
        >
          {sending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <Send className="w-3 h-3" />
              Send {type === "bug" ? "Bug Report" : "Feature Suggestion"}
            </>
          )}
        </button>
      </form>
    </motion.div>
  );
}

/* ── Main Widget ────────────────────────────────────────────────────────────── */

/* ── CSS-only tooltip on the toggle button ────────────────────────────────── */
/* Uses data-tooltip attribute set by React; all show/hide/position is CSS.   */

const tooltipStyle = `
.floating-social-toggle {
  position: relative;
}
.floating-social-toggle::after {
  content: attr(data-tooltip);
  position: absolute;
  right: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 10px;
  border-radius: 6px;
  background: #111;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.floating-social-toggle::before {
  content: '';
  position: absolute;
  right: calc(100% + 4px);
  top: 50%;
  transform: translateY(-50%);
  border: 4px solid transparent;
  border-left-color: #111;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.floating-social-toggle:hover::after,
.floating-social-toggle:hover::before {
  opacity: 1;
}
`;

export default function FloatingSocial() {
  const [view, setView] = useState<FeedbackView>("closed");

  const open = view !== "closed";

  return (
    <>
      <style>{tooltipStyle}</style>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {/* Expanded content */}
      <AnimatePresence mode="wait">
        {view === "menu" && (
          <motion.div
            key="menu"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-2"
          >
            {/* Send Feedback */}
            <button
              onClick={() => setView("form")}
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white border border-border shadow-lg hover:shadow-xl hover:border-orange-200 transition-all text-left group"
            >
              <div className="w-7 h-7 rounded-full bg-orange-50 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                <MessageSquarePlus className="w-3.5 h-3.5 text-orange-500" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-foreground leading-tight">Send Feedback</p>
                <p className="text-[9px] text-muted-foreground">Bug report or feature idea</p>
              </div>
            </button>

            {/* Join Slack */}
            {SLACK_URL && (
              <a
                href={SLACK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white border border-border shadow-lg hover:shadow-xl hover:border-purple-200 transition-all text-left group"
                onClick={() => setView("closed")}
              >
                <div className="w-7 h-7 rounded-full bg-purple-50 flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                  <MessageCircle className="w-3.5 h-3.5 text-purple-500" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-foreground leading-tight">Join Slack</p>
                  <p className="text-[9px] text-muted-foreground">Follow daily development</p>
                </div>
              </a>
            )}
          </motion.div>
        )}

        {view === "form" && (
          <FeedbackForm
            key="form"
            onBack={() => setView("menu")}
            onSent={() => setView("thanks")}
          />
        )}

        {view === "thanks" && (
          <motion.div
            key="thanks"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="bg-white border border-border rounded-2xl shadow-xl p-4 w-[240px] text-center"
          >
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-teal/10 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-teal" />
            </div>
            <p className="text-[11px] font-semibold text-foreground">Thank you!</p>
            <p className="text-[9px] text-muted-foreground mt-0.5 mb-3">
              Your feedback helps shape the product.
            </p>
            <button
              onClick={() => setView("closed")}
              className="text-[9px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Close
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle button */}
      <button
        onClick={() => setView((v) => (v === "closed" ? "menu" : "closed"))}
        className="floating-social-toggle w-12 h-12 rounded-full bg-teal hover:bg-teal-dark shadow-lg hover:shadow-xl flex items-center justify-center text-white transition-all active:scale-95"
        aria-label={open ? "Close menu" : "Open contact menu"}
        data-tooltip={open ? "Close" : "Feedback \u0026 Community"}
      >
        {open ? (
          <X className="w-5 h-5" />
        ) : (
          <ChevronUp className="w-5 h-5" />
        )}
      </button>
    </div>
    </>
  );
}
