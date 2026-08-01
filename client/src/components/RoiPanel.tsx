/**
 * ROI panel — the report a CTO forwards, and the audit trail behind it.
 *
 * Two numbers are shown, deliberately, side by side: what we can prove and what
 * we estimate. Vendor ROI dashboards get dismissed because they blend those
 * into one confident figure, and the first CFO question ("how do you know?")
 * has no answer. Here the conservative number is the headline and the estimate
 * sits next to it with its assumption written out.
 *
 * Selling with the smaller number is the counterintuitive part. It is also why
 * the number survives the meeting.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, FileText, History, Loader2, RefreshCw, ShieldCheck, TrendingUp, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface SavingsLine {
  label: string;
  amount: number;
  basis: "measured" | "estimated";
  assumption?: string;
  count: number;
}

interface RoiReport {
  costCents: number;
  providerSpendCents: number;
  savings: SavingsLine[];
  measuredSavingsCents: number;
  estimatedSavingsCents: number;
  conservativeRoi: number;
  headlineRoi: number;
  incidents: {
    loopsStopped: number;
    budgetBreaches: number;
    scopeViolations: number;
    ungroundedClaims: number;
    attacksRepelled: number;
    selfHealed: number;
  };
  latency: { p50AddedMs: number; p95AddedMs: number; failoverEvents: number; outagesAbsorbed: number };
  narrative: string;
}

interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  actorKind: string;
  action: string;
  outcome: string;
  reason?: string;
  code?: string;
  sessionId?: string;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface RetroactiveReport {
  callCount: number;
  totalCostCents: number | null;
  costCoverage: number;
  loops: { startIndex: number; count: number; costCents: number; sample: string }[];
  loopCostCents: number;
  commitmentCandidates: { index: number; at: number; text: string; matched: string }[];
  limitations: string[];
  narrative: string;
}

const SAMPLE_EXPORT = JSON.stringify(
  {
    calls: [
      { at: Date.now() - 86400000, costCents: 8, promptPreview: "summarize ticket #4471" },
      { at: Date.now() - 86300000, costCents: 12, promptPreview: "reconcile batch — parse error" },
      { at: Date.now() - 86290000, costCents: 12, promptPreview: "reconcile batch — parse error" },
      { at: Date.now() - 86280000, costCents: 12, promptPreview: "reconcile batch — parse error" },
      {
        at: Date.now() - 86000000,
        costCents: 9,
        promptPreview: "pricing question",
        responsePreview: "Sure, I can do $149/month for you, guaranteed 99.9% uptime.",
      },
    ],
  },
  null,
  2
);

/**
 * Retroactive analysis — run before anyone is a paying customer.
 *
 * Every other panel in this app requires traffic that has already gone
 * through The Lyceum. This is the exception on purpose: a prospect deciding
 * whether to buy has months of a provider's own usage export and no way to
 * see, without paying first, whether this would have caught anything in it.
 * Nothing here is stored — the export is the prospect's data before they are
 * a customer, and it should not need to become ours to get an answer.
 */
function RetroactivePanel({ licenseKey }: { licenseKey: string }) {
  const [input, setInput] = useState("");
  const [report, setReport] = useState<RetroactiveReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setError(null);
    setLoading(true);
    try {
      const parsed = JSON.parse(input);
      const calls = Array.isArray(parsed) ? parsed : parsed.calls;
      if (!Array.isArray(calls)) {
        setError('Expected {"calls": [...]} or a bare array of call records.');
        return;
      }
      const res = await fetch("/api/v1/roi/retroactive", {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ calls }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? `Request failed (${res.status}).`);
        return;
      }
      setReport(d);
    } catch {
      setError("That is not valid JSON. Paste an export shaped like the example below.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold text-ws-text mb-1 flex items-center gap-1.5">
        <History className="w-3.5 h-3.5 text-ws-text-soft" />
        Check your past spend
      </h2>
      <p className="text-[12px] text-ws-text-muted mb-3 leading-relaxed max-w-2xl">
        Not a customer yet, or just want to see what an old bill was actually paying for? Paste an
        export of past API calls — from your provider's usage dashboard, a log file, anything with a
        timestamp and ideally the prompt text. Nothing here is stored.
      </p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={SAMPLE_EXPORT}
        rows={6}
        className="w-full px-3 py-2.5 rounded-lg border border-ws-border bg-ws-bg text-[12px] font-mono placeholder:text-ws-text-muted/60 focus:outline-none focus:border-teal resize-y mb-2"
      />
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={run}
          disabled={loading || !input.trim()}
          className="h-8 px-3 rounded-lg text-[12px] font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Analyze
        </button>
        <button
          onClick={() => setInput(SAMPLE_EXPORT)}
          className="text-[11px] text-ws-text-muted hover:text-ws-text-soft"
        >
          Use the example
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 mb-4">
          <p className="text-[12px] text-red-700">{error}</p>
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="rounded-xl border border-ws-border bg-ws-subtle p-3.5">
            <p className="text-[12px] text-ws-text leading-relaxed">{report.narrative}</p>
          </div>

          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            <div className="rounded-lg border border-ws-border bg-ws-bg p-2.5">
              <p className="text-lg font-semibold text-ws-text tabular-nums">{report.callCount}</p>
              <p className="text-[10px] text-ws-text-muted">calls reviewed</p>
            </div>
            <div className="rounded-lg border border-ws-border bg-ws-bg p-2.5">
              <p className="text-lg font-semibold text-ws-text tabular-nums">
                {report.totalCostCents !== null ? usd(report.totalCostCents) : "—"}
              </p>
              <p className="text-[10px] text-ws-text-muted">
                {report.totalCostCents !== null ? "total spend" : "incomplete cost data"}
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-lg font-semibold text-amber-900 tabular-nums">{report.loops.length}</p>
              <p className="text-[10px] text-amber-800">loop(s) found</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-lg font-semibold text-amber-900 tabular-nums">
                {report.commitmentCandidates.length}
              </p>
              <p className="text-[10px] text-amber-800">figures to review</p>
            </div>
          </div>

          {report.loops.map((l, i) => (
            <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[12px] text-amber-900">
                <strong>{l.count}× in a row:</strong> "{l.sample}"
                {l.costCents > 0 && <> — {usd(l.costCents)}</>}
              </p>
            </div>
          ))}

          {report.commitmentCandidates.map((c, i) => (
            <div key={i} className="rounded-lg border border-ws-border bg-ws-bg p-3">
              <p className="text-[11px] text-ws-text-muted mb-1">Matched: {c.matched}</p>
              <p className="text-[12px] text-ws-text-soft">"{c.text}"</p>
            </div>
          ))}

          <div className="flex items-start gap-2 text-[11px] text-ws-text-muted">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
            <div className="space-y-1">
              {report.limitations.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function RoiPanel({ licenseKey }: { licenseKey: string }) {
  const [report, setReport] = useState<RoiReport | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  /** Annual contract value in dollars — drives the ROI ratio. */
  const [acv, setAcv] = useState(24000);

  useEffect(() => {
    const monthlyCents = Math.round((acv / 12) * 100);
    Promise.all([
      fetch(`/api/v1/roi?days=30&subscriptionCents=${monthlyCents}`, {
        headers: { Authorization: `Bearer ${licenseKey}` },
      }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/v1/audit?limit=50", {
        headers: { Authorization: `Bearer ${licenseKey}` },
      }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([roi, aud]) => {
        if (roi) setReport(roi);
        if (aud) setAudit(aud.entries);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [licenseKey, acv]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ws-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Building the report…
      </div>
    );
  }

  if (!report) return null;

  const nothingYet =
    report.measuredSavingsCents === 0 &&
    report.estimatedSavingsCents === 0 &&
    audit.length === 0;

  return (
    <div className="space-y-6">
      <RetroactivePanel licenseKey={licenseKey} />

      <section>
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-ws-text flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-ws-text-soft" />
            Last 30 days
          </h2>
          <label className="text-[11px] text-ws-text-muted flex items-center gap-1.5">
            Your contract
            <select
              value={acv}
              onChange={(e) => setAcv(Number(e.target.value))}
              className="h-7 px-1.5 rounded-md border border-ws-border bg-ws-bg text-[11px] text-ws-text"
            >
              {[12000, 24000, 48000, 96000].map((v) => (
                <option key={v} value={v}>
                  ${(v / 1000).toFixed(0)}k/yr
                </option>
              ))}
            </select>
          </label>
        </div>

        {nothingYet ? (
          <div className="rounded-xl border border-dashed border-ws-border p-6 text-center">
            <p className="text-[13px] text-ws-text mb-1">No traffic yet</p>
            <p className="text-[11px] text-ws-text-muted max-w-md mx-auto leading-relaxed">
              This fills in as your agents run. We show zero rather than a projection — a savings
              figure before any traffic exists is the kind of number that gets a vendor report
              thrown out.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 mb-4">
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <p className="text-[11px] uppercase tracking-wide text-green-800 mb-1">
                  Proven savings
                </p>
                <p className="text-2xl font-semibold text-green-900 tabular-nums">
                  {usd(report.measuredSavingsCents)}
                </p>
                <p className="text-[11px] text-green-800 mt-1">
                  {report.conservativeRoi.toFixed(1)}× the subscription. Every cent traceable to a
                  specific blocked call in the audit trail.
                </p>
              </div>
              <div className="rounded-xl border border-ws-border bg-ws-bg p-4">
                <p className="text-[11px] uppercase tracking-wide text-ws-text-muted mb-1">
                  Including estimates
                </p>
                <p className="text-2xl font-semibold text-ws-text tabular-nums">
                  {usd(report.measuredSavingsCents + report.estimatedSavingsCents)}
                </p>
                <p className="text-[11px] text-ws-text-muted mt-1">
                  {report.headlineRoi.toFixed(1)}× — includes what stopped loops would likely have
                  cost. Defensible, but an assumption.
                </p>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {report.savings.map((s) => (
                <div key={s.label} className="rounded-xl border border-ws-border bg-ws-bg p-3">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <p className="text-[13px] text-ws-text">{s.label}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-ws-text-muted tabular-nums">×{s.count}</span>
                      <span className="text-[13px] font-medium text-ws-text tabular-nums">
                        {s.amount > 0 ? usd(s.amount) : "—"}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded border",
                          s.basis === "measured"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        )}
                      >
                        {s.basis}
                      </span>
                    </div>
                  </div>
                  {s.assumption && (
                    <p className="text-[11px] text-ws-text-muted leading-relaxed">{s.assumption}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 mb-4">
              {[
                { label: "Loops cut", value: report.incidents.loopsStopped },
                { label: "Budget blocks", value: report.incidents.budgetBreaches },
                { label: "Scope blocks", value: report.incidents.scopeViolations },
                { label: "Invented facts", value: report.incidents.ungroundedClaims },
                { label: "Outages absorbed", value: report.latency.outagesAbsorbed },
                { label: "p95 added", value: `${report.latency.p95AddedMs}ms` },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-ws-border bg-ws-bg p-2.5">
                  <p className="text-lg font-semibold text-ws-text tabular-nums leading-tight">
                    {m.value}
                  </p>
                  <p className="text-[10px] text-ws-text-muted">{m.label}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-ws-border bg-ws-subtle p-3.5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-[12px] font-medium text-ws-text">For the board</p>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(report.narrative);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-ws-text-muted hover:text-ws-text shrink-0"
                  aria-label="Copy the summary"
                >
                  {copied ? <ShieldCheck className="w-3.5 h-3.5 text-teal" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[12px] text-ws-text-soft leading-relaxed">{report.narrative}</p>
            </div>
          </>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ws-text mb-1 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-ws-text-soft" />
          Audit trail
        </h2>
        <p className="text-[12px] text-ws-text-muted mb-3 leading-relaxed">
          Every decision, written at the moment it was made. Nothing here is reconstructed after the
          fact — which is the only version an auditor accepts.
        </p>

        {audit.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ws-border p-6 text-center">
            <p className="text-[12px] text-ws-text-muted">
              No events recorded yet. Blocked calls, breaches and approvals appear here as they happen.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-ws-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-ws-subtle">
                  <tr className="text-left text-[11px] text-ws-text-muted">
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Actor</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 font-medium">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((e) => (
                    <tr key={e.id} className="border-t border-ws-border">
                      <td className="px-3 py-2 text-ws-text-muted whitespace-nowrap tabular-nums">
                        {new Date(e.at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-ws-text">{e.actor}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ws-text-soft">
                        {e.code ?? e.action}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                          {e.outcome}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ws-text-muted">{e.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
