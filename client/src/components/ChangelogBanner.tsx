"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { getLatestChangelog, type ChangelogEntry } from "@/lib/dev-changelog";

const DISMISSED_KEY = "lyceum-changelog-dismissed";

/**
 * Subtle slide-in banner on workspace pages showing the latest daily
 * development update. Automatically shows when a new day's entry is
 * available. Dismissal persists in localStorage so it doesn't re-appear
 * until the next changelog update.
 */
export default function ChangelogBanner() {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const latest = getLatestChangelog();
    setEntry(latest);

    // Check if this specific day has been dismissed
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      setDismissed(stored === String(latest.day));
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (entry) {
      try {
        localStorage.setItem(DISMISSED_KEY, String(entry.day));
      } catch {
        // localStorage unavailable — fine
      }
    }
  };

  return (
    <AnimatePresence>
      {entry && !dismissed && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="relative bg-gradient-to-r from-teal-50/80 via-white to-emerald-50/80 border-b border-teal-100/50 dark:from-teal-500/10 dark:via-transparent dark:to-emerald-500/10 dark:border-teal-500/20 dark:bg-ws-subtle">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
              {/* Icon */}
              <div className="shrink-0 w-6 h-6 rounded-full bg-teal-500/10 flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-teal-600 dark:text-teal-400" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-teal-800 dark:text-teal-300 leading-tight">
                  Day {entry.day} of development
                </p>
                <p className="text-[10px] text-teal-600/70 dark:text-teal-400/80 leading-relaxed mt-0.5">
                  <span className="font-medium">{entry.title}</span>
                  {" — "}
                  {entry.description}
                </p>
              </div>

              {/* Dismiss */}
              <button
                onClick={handleDismiss}
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-teal-400 hover:text-teal-600 hover:bg-teal-100/50 dark:hover:text-teal-300 dark:hover:bg-teal-500/20 transition-colors"
                aria-label="Dismiss update"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Subtle bottom shimmer */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-teal-200/50 to-transparent dark:via-teal-500/30" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
