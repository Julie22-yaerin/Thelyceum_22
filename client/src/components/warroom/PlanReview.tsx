/**
 * Plan review — where a human answers the agent's questions, then approves or
 * sends the plan back.
 *
 * The interface is built so approving is a deliberate act rather than the path
 * of least resistance:
 *
 *   - Irreversible and high-risk steps are visually separated, because those
 *     are the ones worth arguing with and they get lost in a flat list.
 *   - The approve button carries the version. If the plan changed while it was
 *     on screen, the server rejects the approval and says so — approving what
 *     you actually read is the only approval that means anything.
 *   - Requesting changes needs a written reason. "No" without a reason produces
 *     another plan that guesses, and the loop repeats.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ClarifyingQuestion {
  id: string;
  question: string;
  whyItMatters: string;
  answer?: string;
}

export interface PlanStep {
  id: string;
  order: number;
  title: string;
  detail: string;
  tools: string[];
  risk: "low" | "medium" | "high";
  estimatedCents: number;
  irreversible: boolean;
  status: string;
  result?: string;
}

export interface Plan {
  id: string;
  agentId: string;
  agentName: string;
  department: string;
  goal: string;
  status: string;
  version: number;
  questions: ClarifyingQuestion[];
  steps: PlanStep[];
  revisions: { at: number; by: string; note: string }[];
}

const RISK_STYLE: Record<string, string> = {
  low: "bg-white/5 text-white/50",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-red-500/15 text-red-300",
};

export default function PlanReview({
  licenseKey,
  planId,
  onClose,
  onChanged,
}: {
  licenseKey: string;
  planId: string;
  onClose: () => void;
  onChanged: (plan: Plan) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revisionNote, setRevisionNote] = useState("");
  const [showRevise, setShowRevise] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = {
    Authorization: `Bearer ${licenseKey}`,
    "Content-Type": "application/json",
  };

  const load = async () => {
    const res = await fetch(`/api/v1/plans/${planId}`, { headers });
    if (res.ok) {
      const d = await res.json();
      setPlan(d.plan);
      setAnswers(
        Object.fromEntries((d.plan.questions ?? []).map((q: ClarifyingQuestion) => [q.id, q.answer ?? ""]))
      );
    }
  };

  useEffect(() => {
    void load();
  }, [planId]);

  const call = async (path: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Something went wrong.");
        // Reload: the most common failure is the plan having moved on, and
        // showing the operator the stale version they just failed to act on
        // would be worse than the error itself.
        await load();
        return null;
      }
      setPlan(d.plan);
      onChanged(d.plan);
      return d.plan as Plan;
    } finally {
      setBusy(false);
    }
  };

  if (!plan) {
    return (
      <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/50" />
      </div>
    );
  }

  const unanswered = plan.questions.filter((q) => !answers[q.id]?.trim());
  const totalCents = plan.steps.reduce((s, x) => s + x.estimatedCents, 0);
  const risky = plan.steps.filter((s) => s.risk === "high" || s.irreversible);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl my-6 rounded-2xl border border-white/10 bg-[#0f0f12] text-white overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3">
          <button onClick={onClose} className="text-white/40 hover:text-white/80 mt-0.5 shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium leading-snug">{plan.goal}</p>
            <p className="text-[11px] text-white/40 mt-0.5">
              {plan.agentName} · {plan.department} · v{plan.version} ·{" "}
              <span className="capitalize">{plan.status}</span>
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-3 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[12px] text-red-200">{error}</p>
            </div>
          )}

          {/* ── Clarifying questions ───────────────────────────────────── */}
          {plan.status === "clarifying" && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-white/40 mb-1">
                It needs answers first
              </p>
              <p className="text-[12px] text-white/50 mb-3 leading-relaxed">
                The agent will not plan around a guess. Each question below says why it cannot
                proceed without the answer.
              </p>
              <div className="space-y-3">
                {plan.questions.map((q) => (
                  <div key={q.id}>
                    <p className="text-[13px] text-white/90 mb-0.5">{q.question}</p>
                    <p className="text-[11px] text-white/35 mb-1.5">{q.whyItMatters}</p>
                    <textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-[13px] placeholder:text-white/25 focus:outline-none focus:border-white/30 resize-y"
                      placeholder="Your answer"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Steps ─────────────────────────────────────────────────── */}
          {plan.steps.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-[11px] uppercase tracking-wider text-white/40">
                  The plan ({plan.steps.length} steps)
                </p>
                <p className="text-[11px] text-white/40">
                  ~${(totalCents / 100).toFixed(2)} estimated
                </p>
              </div>

              {risky.length > 0 && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5 mb-2.5">
                  <p className="text-[12px] text-amber-200 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {risky.length} step{risky.length !== 1 ? "s" : ""} {risky.length === 1 ? "is" : "are"}{" "}
                    high-risk or cannot be undone. Those are the ones worth reading closely.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                {plan.steps.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "rounded-lg border p-3",
                      s.irreversible || s.risk === "high"
                        ? "border-amber-800/40 bg-amber-950/10"
                        : "border-white/10 bg-white/[0.02]"
                    )}
                  >
                    <div className="flex items-start gap-2 mb-1">
                      <span className="text-[11px] text-white/30 tabular-nums shrink-0 mt-0.5">
                        {s.order}
                      </span>
                      <p className="text-[13px] text-white/90 flex-1">{s.title}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {s.irreversible && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">
                            can't undo
                          </span>
                        )}
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded", RISK_STYLE[s.risk])}>
                          {s.risk}
                        </span>
                      </div>
                    </div>
                    <p className="text-[12px] text-white/50 leading-relaxed pl-5 mb-1.5">{s.detail}</p>
                    {s.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-5">
                        {s.tools.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/40"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Revision history ──────────────────────────────────────── */}
          {plan.revisions.length > 0 && (
            <section>
              <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Sent back {plan.revisions.length} time{plan.revisions.length !== 1 ? "s" : ""}
              </p>
              <div className="space-y-1.5">
                {plan.revisions.map((r, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <p className="text-[12px] text-white/70">{r.note}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">
                      {r.by} · {new Date(r.at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              {plan.revisions.length >= 3 && (
                <p className="text-[11px] text-amber-300/70 mt-2">
                  Three rounds usually means the goal itself is unclear, not the plan. Worth
                  rewriting the goal instead of the plan.
                </p>
              )}
            </section>
          )}
        </div>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-t border-white/10">
          {plan.status === "clarifying" ? (
            <button
              onClick={async () => {
                await call(`/api/v1/plans/${plan.id}/answers`, {
                  answers: Object.entries(answers).map(([id, answer]) => ({ id, answer })),
                });
              }}
              disabled={busy || unanswered.length > 0}
              className="w-full h-10 rounded-lg bg-white text-black font-medium text-[13px] disabled:opacity-30 inline-flex items-center justify-center gap-2 transition-opacity"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {unanswered.length > 0
                ? `${unanswered.length} question${unanswered.length !== 1 ? "s" : ""} left`
                : "Send answers — it will plan next"}
            </button>
          ) : plan.status === "planned" ? (
            showRevise ? (
              <div>
                <textarea
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="What needs to change? Be specific — this is what it rewrites against."
                  className="w-full px-3 py-2 mb-2 rounded-lg bg-white/[0.04] border border-white/10 text-[13px] placeholder:text-white/25 focus:outline-none focus:border-white/30 resize-y"
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      const p = await call(`/api/v1/plans/${plan.id}/revise`, { note: revisionNote });
                      if (p) {
                        setShowRevise(false);
                        setRevisionNote("");
                      }
                    }}
                    disabled={busy || !revisionNote.trim()}
                    className="flex-1 h-10 rounded-lg bg-amber-500 text-black font-medium text-[13px] disabled:opacity-30 inline-flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Send it back
                  </button>
                  <button
                    onClick={() => setShowRevise(false)}
                    className="h-10 px-4 rounded-lg text-[13px] text-white/50 hover:text-white/80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    call(`/api/v1/plans/${plan.id}/approve`, { version: plan.version })
                  }
                  disabled={busy}
                  className="flex-1 h-10 rounded-lg bg-emerald-500 text-black font-medium text-[13px] disabled:opacity-40 inline-flex items-center justify-center gap-2"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Approve v{plan.version} and run
                </button>
                <button
                  onClick={() => setShowRevise(true)}
                  className="h-10 px-4 rounded-lg border border-white/15 text-[13px] text-white/80 hover:bg-white/5"
                >
                  Ask for changes
                </button>
              </div>
            )
          ) : (
            <p className="text-[12px] text-white/40 text-center">
              {plan.status === "revising"
                ? "The agent is reworking this. It will come back for approval."
                : plan.status === "approved"
                  ? "Approved. Nothing else needed from you."
                  : `This plan is ${plan.status}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
