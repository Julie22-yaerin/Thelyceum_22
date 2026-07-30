/**
 * Decision Card (DIRECTIVE 3, block 2).
 *
 * Replaces conversational approval. A chat prompt asks a person to read, infer
 * intent, and compose a reply — three chances to get it wrong while an agent is
 * mid-run and money is burning. A card states the facts and offers the three
 * actions that exist, so the decision is a click and the record of that
 * decision is unambiguous.
 *
 * Every field shown here comes from the deterministic breaker, so what the
 * reviewer sees is exactly what was enforced — not a model's summary of it.
 */

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Clock,
  Coins,
  Gauge,
  RefreshCw,
  Repeat,
  ShieldAlert,
  Sliders,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types (mirror the /api/v1/decisions payload) ────────────────────────────

export type BreachCode =
  | "BUDGET_EXCEEDED"
  | "TOOL_CALL_LIMIT"
  | "TOKEN_VELOCITY"
  | "CALL_RATE"
  | "LOOP_DETECTED"
  | "RESTRICTED_PAYLOAD"
  | "UNAUTHORIZED_MCP";

export interface DecisionCardData {
  breachNodeId: string;
  sessionId: string;
  taskName: string;
  reason: string;
  breachCode: BreachCode;
  observed: number | string;
  limit: number | string;
  model?: string;
  occurredAt: number;
  evaluatedInMs?: number;
  spend: { spentCents: number; limitCents: number | null };
  session: {
    totalTokens: number;
    breachCount: number;
    humanDecisionCount: number;
    deepestCausalChain: number;
  };
}

export type DecisionAction =
  | { kind: "approve"; grantCents: number }
  | { kind: "abort" }
  | { kind: "modify"; grantCents: number };

/** Plain-language framing per breach, so the reader never decodes a code. */
const BREACH_META: Record<
  BreachCode,
  { label: string; icon: React.ElementType; tone: string; whatItMeans: string }
> = {
  BUDGET_EXCEEDED: {
    label: "Hit its spending limit",
    icon: Coins,
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    whatItMeans: "The task stopped itself before spending more than you allowed.",
  },
  TOOL_CALL_LIMIT: {
    label: "Used up its tool calls",
    icon: Gauge,
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    whatItMeans: "The task ran as many tool actions as it was allowed.",
  },
  TOKEN_VELOCITY: {
    label: "Burning tokens too fast",
    icon: Gauge,
    tone: "bg-orange-50 text-orange-700 border-orange-200",
    whatItMeans: "Unusually heavy usage in a short window — often a sign of a loop.",
  },
  CALL_RATE: {
    label: "Calling too often",
    icon: RefreshCw,
    tone: "bg-orange-50 text-orange-700 border-orange-200",
    whatItMeans: "The agent is making requests faster than the limit you set.",
  },
  LOOP_DETECTED: {
    label: "Stuck in a loop",
    icon: Repeat,
    tone: "bg-red-50 text-red-700 border-red-200",
    whatItMeans: "The same request repeated over and over. Approving more budget will likely just repeat it again.",
  },
  RESTRICTED_PAYLOAD: {
    label: "Blocked — dangerous command",
    icon: ShieldAlert,
    tone: "bg-red-50 text-red-700 border-red-200",
    whatItMeans: "The request contained something destructive. This cannot be approved.",
  },
  UNAUTHORIZED_MCP: {
    label: "Reached for a tool it isn't allowed",
    icon: ShieldAlert,
    tone: "bg-red-50 text-red-700 border-red-200",
    whatItMeans: "The agent tried to use a server outside its permitted list.",
  },
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// ── Component ───────────────────────────────────────────────────────────────

export function DecisionCard({
  card,
  onDecide,
}: {
  card: DecisionCardData;
  onDecide: (action: DecisionAction) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<DecisionAction["kind"] | null>(null);
  const [showModify, setShowModify] = useState(false);
  const [customDollars, setCustomDollars] = useState("5");

  const meta = BREACH_META[card.breachCode];
  const Icon = meta.icon;

  // A destructive payload is not a budget conversation — approving it is not on
  // offer, and the UI says so rather than presenting a button that will fail.
  const approvable = card.breachCode !== "RESTRICTED_PAYLOAD" && card.breachCode !== "UNAUTHORIZED_MCP";

  const limitCents = card.spend.limitCents;
  const pctUsed =
    limitCents && limitCents > 0
      ? Math.min(100, Math.round((card.spend.spentCents / limitCents) * 100))
      : null;

  const run = async (action: DecisionAction) => {
    setBusy(action.kind);
    try {
      await onDecide(action);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="rounded-xl border border-ws-border bg-ws-bg overflow-hidden">
      {/* ── What happened ── */}
      <header className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-ws-text-muted mb-1">
              Task paused
            </p>
            <h3 className="text-sm font-semibold text-ws-text truncate">{card.taskName}</h3>
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border",
              meta.tone
            )}
          >
            <Icon className="w-3 h-3" />
            {meta.label}
          </span>
        </div>

        <p className="text-[13px] text-ws-text-soft leading-relaxed">{card.reason}</p>
        <p className="text-[11px] text-ws-text-muted leading-relaxed mt-1">{meta.whatItMeans}</p>
      </header>

      {/* ── Spend vs budget: the number the decision turns on ── */}
      <div className="px-4 pb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[11px] text-ws-text-muted">Spent on this task</span>
          <span className="text-[13px] font-semibold text-ws-text tabular-nums">
            {money(card.spend.spentCents)}
            {limitCents !== null && (
              <span className="text-ws-text-muted font-normal"> of {money(limitCents)}</span>
            )}
          </span>
        </div>
        {pctUsed !== null && (
          <div className="h-1.5 rounded-full bg-ws-hover overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                pctUsed >= 100 ? "bg-red-500" : pctUsed >= 80 ? "bg-amber-500" : "bg-green-500"
              )}
              style={{ width: `${pctUsed}%` }}
            />
          </div>
        )}
      </div>

      {/* ── Supporting facts ── */}
      <dl className="px-4 pb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div className="flex items-center justify-between">
          <dt className="text-ws-text-muted">What tripped</dt>
          <dd className="text-ws-text tabular-nums font-medium">
            {String(card.observed)}{" "}
            <span className="text-ws-text-muted font-normal">/ {String(card.limit)}</span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ws-text-muted">Tokens used</dt>
          <dd className="text-ws-text tabular-nums">{card.session.totalTokens.toLocaleString()}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ws-text-muted">Model</dt>
          <dd className="text-ws-text truncate inline-flex items-center gap-1">
            <Bot className="w-3 h-3 text-ws-text-muted" />
            {card.model ?? "unknown"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ws-text-muted">Paused</dt>
          <dd className="text-ws-text inline-flex items-center gap-1">
            <Clock className="w-3 h-3 text-ws-text-muted" />
            {ago(card.occurredAt)}
          </dd>
        </div>
        {card.session.breachCount > 1 && (
          <div className="col-span-2 flex items-center gap-1.5 text-amber-700">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>
              This task has been paused {card.session.breachCount} times already
              {card.session.humanDecisionCount > 0 &&
                ` — you've stepped in ${card.session.humanDecisionCount} time${card.session.humanDecisionCount !== 1 ? "s" : ""}`}
              .
            </span>
          </div>
        )}
        {card.evaluatedInMs !== undefined && (
          <div className="col-span-2 text-ws-text-muted">
            Decided in {card.evaluatedInMs.toFixed(1)}ms without calling a model.
          </div>
        )}
      </dl>

      {/* ── The three actions ── */}
      <footer className="px-4 py-3 border-t border-ws-border bg-ws-subtle">
        {!approvable ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => run({ kind: "abort" })}
              disabled={busy !== null}
              className="flex-1 h-9 rounded-lg text-[13px] font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
            >
              <Ban className="w-3.5 h-3.5" />
              {busy === "abort" ? "Aborting…" : "Abort task"}
            </button>
            <p className="flex-1 text-[11px] text-ws-text-muted leading-snug">
              This block can't be approved — the request itself is unsafe.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => run({ kind: "approve", grantCents: 100 })}
                disabled={busy !== null}
                className="flex-1 min-w-[150px] h-9 rounded-lg text-[13px] font-medium bg-teal text-white hover:bg-teal-dark disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                {busy === "approve" ? "Approving…" : "Approve +$1 limit"}
              </button>

              <button
                onClick={() => run({ kind: "abort" })}
                disabled={busy !== null}
                className="h-9 px-3 rounded-lg text-[13px] font-medium border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                {busy === "abort" ? "Aborting…" : "Abort task"}
              </button>

              <button
                onClick={() => setShowModify((v) => !v)}
                disabled={busy !== null}
                className="h-9 px-3 rounded-lg text-[13px] font-medium border border-ws-border text-ws-text-soft hover:bg-ws-hover disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Sliders className="w-3.5 h-3.5" />
                Modify constraints
              </button>
            </div>

            {showModify && (
              <div className="mt-3 pt-3 border-t border-ws-border">
                <label className="block text-[11px] text-ws-text-soft mb-1.5">
                  Raise this task's limit by
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ws-text-muted">
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={customDollars}
                      onChange={(e) => setCustomDollars(e.target.value)}
                      className="w-24 h-9 pl-6 pr-2 rounded-lg border border-ws-border bg-ws-bg text-[13px] text-ws-text tabular-nums focus:outline-none focus:border-teal"
                    />
                  </div>
                  <button
                    onClick={() =>
                      run({
                        kind: "modify",
                        grantCents: Math.max(0, Math.round(Number(customDollars) * 100)),
                      })
                    }
                    disabled={busy !== null || !Number(customDollars)}
                    className="h-9 px-3 rounded-lg text-[13px] font-medium bg-ws-text text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    {busy === "modify" ? "Applying…" : "Apply new limit"}
                  </button>
                </div>
                {card.breachCode === "LOOP_DETECTED" && (
                  <p className="text-[11px] text-amber-700 leading-relaxed mt-2">
                    Heads up: this task is repeating itself. More budget will probably be spent
                    repeating it — aborting and fixing the prompt is usually cheaper.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </footer>
    </article>
  );
}

// ── Queue ───────────────────────────────────────────────────────────────────

export function DecisionQueue({
  cards,
  onDecide,
  loading,
}: {
  cards: DecisionCardData[];
  onDecide: (card: DecisionCardData, action: DecisionAction) => Promise<void> | void;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="text-center py-12 text-[13px] text-ws-text-muted">
        Checking for paused tasks…
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ws-border p-10 text-center">
        <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
          <Check className="w-5 h-5 text-green-700" />
        </div>
        <p className="text-sm text-ws-text mb-1">Nothing needs you right now</p>
        <p className="text-[12px] text-ws-text-muted">
          Agents are running inside their limits. Anything that trips a limit will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {cards.map((card) => (
        <DecisionCard
          key={card.breachNodeId}
          card={card}
          onDecide={(action) => onDecide(card, action)}
        />
      ))}
    </div>
  );
}
