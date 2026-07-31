/**
 * Red Team panel — the adversarial suite, run on demand against this workspace.
 *
 * The presentation problem: a security scan that says "0 findings" in green
 * teaches the operator nothing and gets ignored. So the panel leads with WHAT
 * was tried, not with the verdict — the corpus is visible before you run it,
 * and a clean result reads as "these 58 specific attacks were repelled" rather
 * than a reassuring tick.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Shield, ShieldAlert, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

interface CorpusEntry {
  category: string;
  count: number;
  severities: string[];
}

interface Finding {
  attackId: string;
  name: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  department: string;
  detail: string;
  impact: string;
}

interface RunResult {
  run: {
    attacksRun: number;
    blocked: number;
    findings: Finding[];
    departmentsTested: string[];
    startedAt: number;
    finishedAt: number;
  };
  summary: string;
  contributed: { signature: string; stage: string; reason?: string }[];
}

const CATEGORY_LABEL: Record<string, string> = {
  prompt_injection: "Prompt injection",
  scope_escalation: "Scope escalation",
  data_exfiltration: "Data exfiltration",
  budget_exhaustion: "Budget exhaustion",
  loop_induction: "Loop induction",
  grounding_bypass: "Grounding bypass",
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-ws-subtle text-ws-text-soft border-ws-border",
};

export default function RedTeamPanel({ licenseKey }: { licenseKey: string }) {
  const [corpus, setCorpus] = useState<CorpusEntry[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [contribute, setContribute] = useState(true);

  useEffect(() => {
    fetch("/api/v1/redteam/corpus", { headers: { Authorization: `Bearer ${licenseKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCorpus(d.categories))
      .catch(() => {});
  }, [licenseKey]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/v1/redteam/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ contributeToHive: contribute }),
      });
      if (res.ok) setResult(await res.json());
    } finally {
      setRunning(false);
    }
  };

  const totalAttacks = corpus.reduce((s, c) => s + c.count, 0);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-ws-text mb-1 flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-ws-text-soft" />
          What gets attacked
        </h2>
        <p className="text-[12px] text-ws-text-muted mb-3 leading-relaxed">
          {totalAttacks} hostile inputs replayed against your own policy — your departments, your
          allowed tools, your knowledge base. It runs in shadow: no model calls, no production
          traffic, nothing in your data changes.
        </p>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mb-4">
          {corpus.map((c) => (
            <div key={c.category} className="rounded-xl border border-ws-border bg-ws-bg p-3">
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-[13px] font-medium text-ws-text">
                  {CATEGORY_LABEL[c.category] ?? c.category}
                </p>
                <span className="text-[11px] text-ws-text-muted tabular-nums">{c.count}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.severities.map((s) => (
                  <span
                    key={s}
                    className={cn("text-[10px] px-1.5 py-0.5 rounded border", SEVERITY_STYLE[s])}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={running}
            className="h-9 px-4 rounded-lg text-sm font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Swords className="w-3.5 h-3.5" />}
            {running ? "Attacking…" : "Run the suite"}
          </button>
          <label className="flex items-center gap-2 text-[12px] text-ws-text-soft cursor-pointer">
            <input
              type="checkbox"
              checked={contribute}
              onChange={(e) => setContribute(e.target.checked)}
              className="rounded border-ws-border"
            />
            Share any pattern found with other workspaces
          </label>
        </div>
        <p className="text-[11px] text-ws-text-muted mt-2 max-w-2xl leading-relaxed">
          Sharing sends only a de-identified structural skeleton — no text from your workspace, ever.
          You keep receiving other workspaces' immunity whether you share or not.
        </p>
      </section>

      {result && (
        <section>
          <div
            className={cn(
              "rounded-xl border p-4 mb-4",
              result.run.findings.length === 0
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            )}
          >
            <div className="flex items-start gap-2.5">
              {result.run.findings.length === 0 ? (
                <Shield className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ws-text">{result.summary}</p>
                <p className="text-[11px] text-ws-text-muted mt-1">
                  {result.run.attacksRun} attacks · {result.run.blocked} repelled ·{" "}
                  {result.run.departmentsTested.length} departments ·{" "}
                  {result.run.finishedAt - result.run.startedAt}ms
                </p>
              </div>
            </div>
          </div>

          {result.run.findings.length > 0 && (
            <div className="space-y-2 mb-4">
              {result.run.findings.map((f, i) => (
                <div key={`${f.attackId}-${i}`} className="rounded-xl border border-ws-border bg-ws-bg p-3.5">
                  <div className="flex items-start gap-2 mb-1.5">
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border shrink-0",
                        SEVERITY_STYLE[f.severity]
                      )}
                    >
                      {f.severity}
                    </span>
                    <p className="text-[13px] font-medium text-ws-text">{f.name}</p>
                    <span className="text-[11px] text-ws-text-muted ml-auto shrink-0">{f.department}</span>
                  </div>
                  <p className="text-[12px] text-ws-text-soft mb-1.5 font-mono leading-relaxed">
                    {f.detail}
                  </p>
                  <p className="text-[11px] text-red-700 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    {f.impact}
                  </p>
                </div>
              ))}
            </div>
          )}

          {result.contributed.length > 0 && (
            <div className="rounded-xl border border-ws-border bg-ws-subtle p-3.5">
              <p className="text-[12px] font-medium text-ws-text mb-2">Shared with the network</p>
              {result.contributed.map((c, i) => (
                <div key={i} className="text-[11px] text-ws-text-muted mb-1">
                  <span className="font-mono">{c.signature}</span>
                  <span className="mx-1.5">·</span>
                  <span className="text-ws-text-soft">{c.stage}</span>
                  {c.reason && <p className="text-ws-text-muted mt-0.5">{c.reason}</p>}
                </div>
              ))}
            </div>
          )}

          {result.run.findings.length === 0 && (
            <p className="text-[12px] text-ws-text-muted leading-relaxed max-w-2xl">
              Worth reading honestly: this proves your <em>policy</em> holds — a sales agent cannot
              reach finance, a destructive tool is refused, an invented price is rejected. It does
              not tell you how a specific model behaves under a specific jailbreak, because it makes
              no model calls. Those are different questions, and this one answers the part you can fix.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
