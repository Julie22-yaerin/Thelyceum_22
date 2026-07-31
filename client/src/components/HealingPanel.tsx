/**
 * Self-healing settings and history.
 *
 * The whole screen is built around one idea: the operator must never be
 * surprised. Autonomous healing is off until they turn it on here, the risk
 * ceiling is theirs to set, and every fix the system wants to make is visible
 * with its self-assessed risk *before* it is applied.
 *
 * The default is "propose, don't apply". A system that edits production
 * behaviour at 3am is only reassuring if the operator chose that, saw the
 * gate, and can undo it in one click.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealingPolicy {
  autonomousHealingEnabled: boolean;
  maxAutonomousRiskPercent: number;
  excludedKinds?: string[];
}

const KIND_LABEL: Record<string, string> = {
  malformed_json: "Broken JSON output",
  empty_output: "Empty responses",
  schema_violation: "Schema violations",
  infinite_loop: "Repeating actions",
  ungrounded_repeat: "Repeated invented facts",
  refusal_loop: "Refusing everything",
};

/** Mirrors server/healing/riskAssessment.ts — shown so the ceiling is meaningful. */
const KIND_RISK: Record<string, number> = {
  malformed_json: 5,
  empty_output: 10,
  schema_violation: 20,
  infinite_loop: 35,
  ungrounded_repeat: 40,
  refusal_loop: 60,
};

export default function HealingPanel({ licenseKey }: { licenseKey: string }) {
  const [policy, setPolicy] = useState<HealingPolicy | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/healing/policy", { headers: { Authorization: `Bearer ${licenseKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPolicy(d.policy))
      .catch(() => {});
  }, [licenseKey]);

  const save = async (next: Partial<HealingPolicy>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/healing/policy", {
        method: "PUT",
        headers: { Authorization: `Bearer ${licenseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) setPolicy((await res.json()).policy);
    } finally {
      setSaving(false);
    }
  };

  if (!policy) {
    return (
      <div className="flex items-center gap-2 text-sm text-ws-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading healing settings…
      </div>
    );
  }

  const ceiling = policy.maxAutonomousRiskPercent;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-ws-text mb-1 flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-ws-text-soft" />
          When an agent breaks
        </h2>
        <p className="text-[12px] text-ws-text-muted mb-4 leading-relaxed max-w-2xl">
          After four consecutive failures of the same kind, the system writes a candidate fix and
          replays it against the exact failures that triggered it. If the fix doesn't work, it is
          discarded. If it does, what happens next is your decision, not the system's.
        </p>

        <div className="rounded-xl border border-ws-border bg-ws-bg p-4 mb-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={policy.autonomousHealingEnabled}
              onChange={(e) => save({ autonomousHealingEnabled: e.target.checked })}
              disabled={saving}
              className="mt-0.5 rounded border-ws-border"
            />
            <div>
              <p className="text-[13px] font-medium text-ws-text">
                Let it apply low-risk fixes on its own
              </p>
              <p className="text-[11px] text-ws-text-muted mt-0.5 leading-relaxed">
                Off by default. With this off you still get every fix — generated, tested, and
                waiting for one click. Turning it on means a proven fix under your risk ceiling can
                be applied at 3am without waking you.
              </p>
            </div>
          </label>
        </div>

        <div
          className={cn(
            "rounded-xl border p-4 transition-opacity",
            policy.autonomousHealingEnabled ? "border-ws-border bg-ws-bg" : "border-ws-border bg-ws-subtle opacity-60"
          )}
        >
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-[13px] font-medium text-ws-text">Risk ceiling</p>
            <span className="text-lg font-semibold text-ws-text tabular-nums">{ceiling}%</span>
          </div>
          <p className="text-[11px] text-ws-text-muted mb-3">
            A fix the system rates at or above this is never applied on its own, however well it
            tested. It is prepared and handed to you instead.
          </p>
          <input
            type="range"
            min={0}
            max={70}
            step={5}
            value={ceiling}
            disabled={!policy.autonomousHealingEnabled || saving}
            onChange={(e) => save({ maxAutonomousRiskPercent: Number(e.target.value) })}
            className="w-full accent-teal"
          />
          <div className="flex justify-between text-[10px] text-ws-text-muted mt-1">
            <span>0% — nothing automatic</span>
            <span>70% — hard cap</span>
          </div>

          <div className="mt-4 space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-ws-text-muted">
              What that ceiling lets through
            </p>
            {Object.entries(KIND_RISK)
              .sort((a, b) => a[1] - b[1])
              .map(([kind, risk]) => {
                const auto = policy.autonomousHealingEnabled && risk < ceiling;
                return (
                  <div key={kind} className="flex items-center gap-2 text-[12px]">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        auto ? "bg-green-500" : "bg-amber-500"
                      )}
                    />
                    <span className="text-ws-text-soft flex-1 truncate">
                      {KIND_LABEL[kind] ?? kind}
                    </span>
                    <span className="text-ws-text-muted tabular-nums text-[11px]">~{risk}%</span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded shrink-0 w-[72px] text-center",
                        auto ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                      )}
                    >
                      {auto ? "automatic" : "asks you"}
                    </span>
                  </div>
                );
              })}
          </div>

          <p className="text-[11px] text-ws-text-muted mt-3 leading-relaxed">
            Risk is computed from things we can observe — how mechanically verifiable the repair is,
            how much of the prompt it touches, how many agents it reaches, and whether this prompt
            has been healed before without holding. It is not a model's opinion of its own work.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-ws-border bg-ws-subtle p-4">
        <p className="text-[12px] font-medium text-ws-text mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          What this will not do
        </p>
        <ul className="text-[11px] text-ws-text-muted space-y-1.5 leading-relaxed">
          <li>
            <strong className="text-ws-text-soft">It does not rewrite code at runtime.</strong>{" "}
            Prompts are data and can be swapped safely. Generating code with a model and running it
            inside the process that holds your credentials is a remote-execution hole, and no amount
            of sandboxing makes that a good trade.
          </li>
          <li>
            <strong className="text-ws-text-soft">It does not rewrite your prompt.</strong> Repairs
            are appended, so a business rule you wrote can never be silently dropped.
          </li>
          <li>
            <strong className="text-ws-text-soft">It does not survive a deploy.</strong> A healed
            prompt lives in memory. If you want it permanently, you edit it — nobody should discover
            a prompt in production that no human approved.
          </li>
          <li>
            <strong className="text-ws-text-soft">It never heals a correct refusal.</strong> An
            agent saying "I don't have that in the knowledge base" is working as designed, and is
            explicitly excluded from failure detection.
          </li>
        </ul>
      </section>

      <section className="flex items-start gap-2 text-[11px] text-ws-text-muted">
        <RotateCcw className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Every applied fix is versioned. Rolling back is a single call and restores the exact
          previous prompt — "it fixed itself overnight" is only reassuring if you can also undo it.
        </p>
      </section>
    </div>
  );
}
