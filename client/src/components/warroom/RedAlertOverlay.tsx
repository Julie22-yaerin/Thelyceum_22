/**
 * Red alert — the screen takeover when an agent is about to do something
 * categorically dangerous.
 *
 * Design decisions that matter more than the visuals:
 *
 * 1. It blocks everything. Not a toast, not a banner. If exfiltration is
 *    seconds away, an operator scrolling past a notification is a failure of
 *    the interface, not of their attention.
 *
 * 2. The brake is the primary action and Continue is not. The layout, colour
 *    and focus order all assume stopping is correct — because at the moment
 *    this appears, it usually is.
 *
 * 3. Continue requires reading. There is a mandatory dwell before it enables,
 *    long enough that muscle memory cannot dismiss the alert. Two seconds is
 *    irritating by design; an alert you can reflexively click through is
 *    decoration.
 *
 * 4. The evidence is quoted verbatim. The operator judges the actual text the
 *    agent produced, not our summary of it.
 */

import { useEffect, useRef, useState } from "react";
import { AlertOctagon, Ban, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DangerSignal {
  danger: string;
  evidence: string;
  explanation: string;
}

export interface RedAlert {
  id: string;
  agentId: string;
  agentName: string;
  planId?: string;
  stepTitle?: string;
  danger: DangerSignal;
  raisedAt: number;
}

const DANGER_LABEL: Record<string, string> = {
  data_exfiltration: "Data leaving the building",
  infrastructure_attack: "Attack on infrastructure",
  credential_access: "Credential access",
  destructive_operation: "Irreversible destruction",
  financial_movement: "Money movement",
  impersonation: "Impersonation",
};

/** Seconds the operator must sit with the alert before Continue enables. */
const DWELL_SECONDS = 2;

export default function RedAlertOverlay({
  alert,
  onContinue,
  onBrake,
}: {
  alert: RedAlert | null;
  onContinue: (id: string) => void;
  onBrake: (id: string) => Promise<{ elapsedMs: number; withinSla: boolean } | null>;
}) {
  const [dwell, setDwell] = useState(DWELL_SECONDS);
  const [braking, setBraking] = useState(false);
  const [brakeResult, setBrakeResult] = useState<{ elapsedMs: number; withinSla: boolean } | null>(
    null
  );
  /**
   * The overlay holds its own copy of the alert.
   *
   * Pulling the brake clears the alert server-side, so the next poll hands
   * down `null` — which unmounted this component before the operator could
   * read whether the brake made its SLA. That is the single most important
   * thing to tell them, so the overlay stays up on its own copy until they
   * dismiss it.
   */
  const [held, setHeld] = useState<RedAlert | null>(alert);
  /**
   * The alert object is rebuilt by every poll, so reacting to the object
   * identity re-ran this effect every few seconds and wiped the brake result
   * the operator was still reading. Only a genuinely different alert id is a
   * new alert.
   */
  const seenId = useRef<string | null>(alert?.id ?? null);

  useEffect(() => {
    if (alert) {
      if (seenId.current !== alert.id) {
        seenId.current = alert.id;
        setDwell(DWELL_SECONDS);
        setBrakeResult(null);
      }
      setHeld(alert);
      return;
    }
    // Upstream cleared it. Only follow if we are not showing a brake result —
    // braking clears it server-side, and unmounting here would hide whether
    // the brake made its SLA.
    if (!brakeResult) {
      seenId.current = null;
      setHeld(null);
    }
  }, [alert, brakeResult]);

  useEffect(() => {
    if (!held) return;
    const t = setInterval(() => setDwell((d) => Math.max(0, d - 1)), 1000);
    return () => clearInterval(t);
  }, [held?.id]);

  // Escape must not dismiss this. A reflex keypress is exactly the input we
  // are guarding against.
  useEffect(() => {
    if (!held) return;
    const block = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.preventDefault();
    };
    document.addEventListener("keydown", block, true);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", block, true);
      document.body.style.overflow = "";
    };
  }, [held]);

  if (!held) return null;

  const brake = async () => {
    setBraking(true);
    try {
      setBrakeResult(await onBrake(held.id));
    } finally {
      setBraking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-red-950/95 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="red-alert-title"
    >
      <div className="w-full max-w-2xl my-8">
        <div className="flex items-center gap-3 mb-5">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <p className="text-[11px] uppercase tracking-[0.2em] text-red-300 font-medium">
            Everything is paused
          </p>
        </div>

        <h1 id="red-alert-title" className="text-2xl font-semibold text-white mb-2 flex items-start gap-3">
          <AlertOctagon className="w-7 h-7 text-red-400 shrink-0 mt-0.5" />
          {DANGER_LABEL[held.danger.danger] ?? "Dangerous action"}
        </h1>

        <p className="text-[15px] text-red-100 leading-relaxed mb-5">{held.danger.explanation}</p>

        <div className="rounded-xl border border-red-800/60 bg-red-950/60 p-4 mb-4">
          <p className="text-[11px] uppercase tracking-wider text-red-300 mb-2">Who</p>
          <p className="text-[14px] text-white mb-3">
            {held.agentName}
            {held.stepTitle && (
              <span className="text-red-200">
                {" "}
                — while doing "{held.stepTitle}"
              </span>
            )}
          </p>

          <p className="text-[11px] uppercase tracking-wider text-red-300 mb-2">
            What it was about to do
          </p>
          <pre className="rounded-lg bg-black/50 border border-red-900/60 px-3 py-2.5 overflow-x-auto">
            <code className="text-[12px] leading-relaxed text-red-100 whitespace-pre-wrap break-words">
              {held.danger.evidence}
            </code>
          </pre>
          <p className="text-[11px] text-red-300/80 mt-2">
            Quoted exactly as the agent produced it, so you can judge it rather than judge our
            summary of it.
          </p>
        </div>

        {brakeResult && (
          <div
            className={cn(
              "rounded-xl border p-4 mb-4",
              brakeResult.withinSla
                ? "border-green-700 bg-green-950/60"
                : "border-amber-700 bg-amber-950/60"
            )}
          >
            <p className="text-[14px] font-medium text-white mb-1">
              Everything stopped in {brakeResult.elapsedMs}ms
            </p>
            <p className="text-[12px] text-white/70">
              {brakeResult.withinSla
                ? "Within the 1000ms commitment. Every agent is halted and every running plan is frozen."
                : `Over the 1000ms commitment. We are telling you because a brake that silently ran slow is worse than no brake — you would have acted differently had you not known.`}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={brake}
            disabled={braking || !!brakeResult}
            className="flex-1 h-12 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-semibold text-[15px] inline-flex items-center justify-center gap-2 transition-colors"
          >
            {braking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Ban className="w-4 h-4" />
            )}
            {brakeResult ? "Stopped" : braking ? "Stopping…" : "Emergency brake — stop everything"}
          </button>

          <button
            onClick={() => {
              if (brakeResult) {
                setHeld(null);
                setBrakeResult(null);
                return;
              }
              onContinue(held.id);
            }}
            disabled={dwell > 0 && !brakeResult}
            className={cn(
              "sm:w-52 h-12 rounded-xl border text-[14px] transition-colors inline-flex items-center justify-center gap-2",
              dwell > 0 && !brakeResult
                ? "border-red-900 text-red-400/50 cursor-not-allowed"
                : "border-red-700 text-red-100 hover:bg-red-900/40"
            )}
          >
            {brakeResult
              ? "Close"
              : dwell > 0
                ? `Read it first (${dwell})`
                : "This is fine, continue"}
          </button>
        </div>

        <p className="text-[11px] text-red-300/70 mt-4 flex items-start gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Continuing is recorded against your name with this evidence attached. Nothing about this
          alert can be turned off in settings — these six categories are never a judgement call.
        </p>
      </div>
    </div>
  );
}
