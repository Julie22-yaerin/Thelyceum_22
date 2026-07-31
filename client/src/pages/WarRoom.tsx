/**
 * The War Room — one screen the founder does not leave.
 *
 * Left: their own work. Right: what the agents are doing. The split exists
 * because the alternative — tabbing to a monitoring dashboard — means nobody
 * looks until something has already gone wrong.
 *
 * Layout: `h-screen` with `overflow-hidden` on the shell and `overflow-y-auto`
 * on each pane, so the page itself never scrolls and the two sides move
 * independently. On mobile they stack, because a 50/50 split on a phone gives
 * two unusable columns instead of one usable one.
 *
 * Dark by default and self-contained: this page does not inherit the Notion
 * light theme used elsewhere. A monitoring surface someone leaves open all day
 * has different requirements from a document editor.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Command,
  DollarSign,
  Loader2,
  Plug,
  Radio,
  Send,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/useSessionStore";
import RedAlertOverlay, { type RedAlert } from "@/components/warroom/RedAlertOverlay";
import IntegrationHub, { CloudSetup } from "@/components/warroom/IntegrationHub";
import PlanReview, { type Plan } from "@/components/warroom/PlanReview";

interface WorkTask {
  id: string;
  text: string;
  done: boolean;
}

/** Reading persisted state must never break the page — bad JSON falls back. */
function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. Losing persistence is survivable;
    // throwing here would take the whole workbench down with it.
  }
}

// ── Live feed ────────────────────────────────────────────────────────────────

interface FeedEvent {
  id: string;
  at: number;
  actor: string;
  text: string;
  level: "info" | "warn" | "block" | "ok";
}

const LEVEL_STYLE: Record<FeedEvent["level"], string> = {
  info: "text-white/50",
  ok: "text-emerald-400/80",
  warn: "text-amber-400/90",
  block: "text-red-400/90",
};

function LiveRadar({ events }: { events: FeedEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [events.length, pinned]);

  return (
    <div className="rounded-lg border border-white/10 bg-black/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <Radio className="w-3 h-3 text-emerald-400" />
        <p className="text-[11px] uppercase tracking-wider text-white/50 flex-1">Live activity</p>
        <button
          onClick={() => setPinned(!pinned)}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded transition-colors",
            pinned ? "bg-white/10 text-white/70" : "text-white/30 hover:text-white/60"
          )}
        >
          {pinned ? "following" : "paused"}
        </button>
      </div>
      <div
        className="h-48 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed"
        onWheel={() => setPinned(false)}
      >
        {events.length === 0 ? (
          <p className="text-white/25">Nothing running. Agent activity streams here as it happens.</p>
        ) : (
          events.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="text-white/20 shrink-0 tabular-nums">
                {new Date(e.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className="text-white/40 shrink-0">[{e.actor}]</span>
              <span className={LEVEL_STYLE[e.level]}>{e.text}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Metrics ──────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "warn";
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon
          className={cn(
            "w-3 h-3",
            tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : "text-white/40"
          )}
        />
        <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      </div>
      <p className="text-lg font-semibold text-white tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-white/35 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type RightTab = "ops" | "integrations" | "cloud";

export default function WarRoom() {
  const licenseKey = useSessionStore((s) => s.licenseKey);

  /**
   * The workbench survives a refresh.
   *
   * It was plain component state, so a founder who typed half a strategy note
   * and hit reload lost it with no warning. For a surface whose whole pitch is
   * "you live here all day", silently discarding their work on navigation is
   * the fastest way to make them stop trusting it.
   *
   * localStorage rather than the server, deliberately: the note explicitly
   * promises nothing here is sent anywhere until they hand it over, and
   * syncing it would quietly break that promise.
   */
  const [note, setNote] = useState(() => readLocal("lyceum.warroom.note", ""));
  const [tasks, setTasks] = useState<WorkTask[]>(() =>
    readLocal<WorkTask[]>("lyceum.warroom.tasks", [])
  );

  useEffect(() => writeLocal("lyceum.warroom.note", note), [note]);
  useEffect(() => writeLocal("lyceum.warroom.tasks", tasks), [tasks]);
  const [newTask, setNewTask] = useState("");
  const [tab, setTab] = useState<RightTab>("ops");
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [alert, setAlert] = useState<RedAlert | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const misses = useRef(0);
  const [metrics, setMetrics] = useState<{
    savedCents: number;
    budgetRemainingCents: number;
    hoursReclaimed: number;
    blocked: number;
  } | null>(null);

  // Poll: agents work outside this tab, so the panel must not depend on the
  // operator refreshing to learn something is wrong.
  useEffect(() => {
    if (!licenseKey) return;
    const headers = { Authorization: `Bearer ${licenseKey}` };
    const tick = async () => {
      try {
        const [feedRes, planRes, alertRes] = await Promise.all([
          fetch("/api/v1/warroom/feed?limit=60", { headers }),
          fetch("/api/v1/plans", { headers }),
          fetch("/api/v1/warroom/alert", { headers }),
        ]);
        if (feedRes.ok) {
          const d = await feedRes.json();
          setEvents(d.events ?? []);
          setMetrics(d.metrics ?? null);
        }
        if (planRes.ok) setPlans((await planRes.json()).plans ?? []);
        if (alertRes.ok) {
          const d = await alertRes.json();
          setAlert(d.alert ?? null);
        }
        misses.current = 0;
        setFeedError(null);
      } catch {
        // One failed tick is usually transient, so don't shout on the first
        // one. But a feed that has been dead for a while while the operator
        // believes it is live is the worst state this panel can be in — they
        // would read "nothing is happening" as "everything is fine".
        misses.current += 1;
        if (misses.current >= 3) {
          setFeedError("Live feed disconnected — this is not showing current activity.");
        }
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [licenseKey]);

  const awaiting = useMemo(
    () => plans.filter((p) => ["clarifying", "planned", "revising"].includes(p.status)),
    [plans]
  );

  const continueAlert = async (id: string) => {
    if (!licenseKey) return;
    await fetch(`/api/v1/warroom/alert/${id}/continue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${licenseKey}` },
    }).catch(() => {});
    setAlert(null);
  };

  const brake = async (id: string) => {
    if (!licenseKey) return null;
    try {
      const res = await fetch(`/api/v1/warroom/alert/${id}/brake`, {
        method: "POST",
        headers: { Authorization: `Bearer ${licenseKey}` },
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  if (!licenseKey) {
    return (
      <div className="h-screen bg-[#0a0a0c] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <Bot className="w-6 h-6 text-white/30 mx-auto mb-3" />
          <p className="text-[15px] text-white/80 mb-1">Enter your license key</p>
          <p className="text-[12px] text-white/40">
            The war room is scoped to your workspace, so it needs your key before it can show you
            anything.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#0a0a0c] text-white flex flex-col">
      <RedAlertOverlay alert={alert} onContinue={continueAlert} onBrake={brake} />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="h-12 shrink-0 border-b border-white/10 flex items-center gap-3 px-4">
        <Bot className="w-4 h-4 text-emerald-400" />
        <span className="text-[13px] font-medium">War Room</span>

        {/* The war room hides global chrome to own the viewport, which also
            removed every way out of it. A full-screen surface with no exit is
            a trap, however good the surface is. */}
        <nav className="hidden sm:flex items-center gap-0.5 ml-2">
          {[
            { href: "/app", label: "Dashboard" },
            { href: "/agents", label: "Agents" },
            { href: "/missions", label: "Departments" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="px-2 py-1 rounded-md text-[12px] text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-4 flex-1 max-w-md relative">
          <Command className="w-3.5 h-3.5 text-white/30 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            placeholder="Search, research, or ask…"
            className="w-full h-7 pl-8 pr-3 rounded-md bg-white/[0.04] border border-white/10 text-[12px] placeholder:text-white/25 focus:outline-none focus:border-white/25"
          />
        </div>

        <button
          onClick={() => {
            setTab("ops");
            if (awaiting[0]) setOpenPlan(awaiting[0].id);
          }}
          className="relative shrink-0 p-1.5 rounded-md hover:bg-white/5 transition-colors"
          aria-label={`${awaiting.length} items need you`}
        >
          <Bell className="w-4 h-4 text-white/60" />
          {awaiting.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-black text-[10px] font-semibold grid place-items-center">
              {awaiting.length}
            </span>
          )}
        </button>
      </header>

      {/* ── Split ───────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_minmax(360px,40%)]">
        {/* ── LEFT: Executive Workbench ─────────────────────────────────── */}
        <main className="min-h-0 overflow-y-auto border-r border-white/10 p-5">
          <div className="max-w-2xl">
            <h1 className="text-[15px] font-medium mb-1">Workbench</h1>
            <p className="text-[12px] text-white/40 mb-5">
              Your side of the desk. The agents run on the right; you only look over when something
              asks for you.
            </p>

            <section className="mb-6">
              <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                Today
              </p>
              <div className="flex gap-2 mb-2">
                <input
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTask.trim()) {
                      setTasks([
                        ...tasks,
                        { id: crypto.randomUUID(), text: newTask.trim(), done: false },
                      ]);
                      setNewTask("");
                    }
                  }}
                  placeholder="Add a task, press Enter"
                  className="flex-1 h-8 px-3 rounded-md bg-white/[0.04] border border-white/10 text-[13px] placeholder:text-white/25 focus:outline-none focus:border-white/25"
                />
              </div>
              {tasks.length === 0 ? (
                <p className="text-[12px] text-white/25">Nothing yet.</p>
              ) : (
                <div className="space-y-1">
                  {tasks.map((t) => (
                    <div
                      key={t.id}
                      className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-white/[0.03]"
                    >
                      <button
                        onClick={() =>
                          setTasks(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
                        }
                        className={cn(
                          "w-3.5 h-3.5 rounded border shrink-0 grid place-items-center transition-colors",
                          t.done ? "bg-emerald-500 border-emerald-500" : "border-white/25"
                        )}
                      >
                        {t.done && <Check className="w-2.5 h-2.5 text-black" />}
                      </button>
                      <span
                        className={cn(
                          "text-[13px] flex-1",
                          t.done ? "text-white/30 line-through" : "text-white/85"
                        )}
                      >
                        {t.text}
                      </span>
                      <button
                        onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))}
                        className="opacity-0 group-hover:opacity-100 text-white/25 hover:text-red-400 transition-all"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Scratchpad</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Strategy, outreach drafts, competitor notes…"
                className="w-full min-h-[280px] p-3.5 rounded-lg bg-white/[0.03] border border-white/10 text-[13px] leading-relaxed placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-y"
              />
              <p className="text-[10px] text-white/25 mt-1.5">
                Saved in this browser and kept across refreshes. Nothing here is sent to an agent
                unless you hand it over.
              </p>
            </section>
          </div>
        </main>

        {/* ── RIGHT: Live Ops ───────────────────────────────────────────── */}
        <aside className="min-h-0 overflow-y-auto bg-black/20">
          <div className="sticky top-0 z-10 bg-[#0a0a0c]/95 backdrop-blur border-b border-white/10 flex">
            {(
              [
                { id: "ops" as const, label: "Live ops", icon: Activity },
                { id: "integrations" as const, label: "Integrations", icon: Plug },
                { id: "cloud" as const, label: "Cloud", icon: CircleDot },
              ]
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "px-3 py-2.5 text-[12px] inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors",
                    tab === t.id
                      ? "border-emerald-400 text-white"
                      : "border-transparent text-white/40 hover:text-white/70"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="p-4 space-y-4">
            {tab === "ops" && (
              <>
                {/* Escalations first — this is the reason to look right. */}
                {awaiting.length > 0 && (
                  <section>
                    <p className="text-[11px] uppercase tracking-wider text-amber-400/80 mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3" />
                      Waiting on you ({awaiting.length})
                    </p>
                    <div className="space-y-1.5">
                      {awaiting.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setOpenPlan(p.id)}
                          className="w-full text-left rounded-lg border border-amber-800/40 bg-amber-950/20 p-2.5 hover:border-amber-700/60 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <p className="text-[12px] text-white/90 flex-1 truncate">{p.goal}</p>
                            <ChevronRight className="w-3.5 h-3.5 text-white/30 shrink-0" />
                          </div>
                          <p className="text-[11px] text-amber-300/70 mt-0.5">
                            {p.agentName} ·{" "}
                            {p.status === "clarifying"
                              ? "needs answers before it can plan"
                              : p.status === "revising"
                                ? "reworking after your notes"
                                : `plan v${p.version} ready to review`}
                          </p>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {metrics && (
                  <section className="grid grid-cols-2 gap-2">
                    <StatCard
                      icon={DollarSign}
                      label="Saved"
                      value={`$${(metrics.savedCents / 100).toFixed(0)}`}
                      sub="blocked spend, measured"
                      tone="good"
                    />
                    <StatCard
                      icon={Zap}
                      label="Budget left"
                      value={`$${(metrics.budgetRemainingCents / 100).toFixed(0)}`}
                      sub="this period"
                    />
                    <StatCard
                      icon={Timer}
                      label="Hours back"
                      value={metrics.hoursReclaimed.toFixed(1)}
                      sub="estimated, not measured"
                    />
                    <StatCard
                      icon={AlertTriangle}
                      label="Blocked"
                      value={String(metrics.blocked)}
                      sub="actions refused"
                      tone={metrics.blocked > 0 ? "warn" : "neutral"}
                    />
                  </section>
                )}

                {feedError && (
                  <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-100 leading-relaxed">{feedError}</p>
                  </div>
                )}

                <LiveRadar events={events} />

                <p className="text-[10px] text-white/25 leading-relaxed">
                  "Hours back" is an estimate and labelled as one. Saved spend and blocked actions
                  are counted from the audit trail and reconcile with it exactly.
                </p>
              </>
            )}

            {tab === "integrations" && (
              <section>
                <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                  Connect a tool as an MCP server
                </p>
                <IntegrationHub licenseKey={licenseKey} />
              </section>
            )}

            {tab === "cloud" && (
              <section>
                <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                  Where inference runs
                </p>
                <CloudSetup licenseKey={licenseKey} />
              </section>
            )}
          </div>
        </aside>
      </div>

      {openPlan && (
        <PlanReview
          licenseKey={licenseKey}
          planId={openPlan}
          onClose={() => setOpenPlan(null)}
          onChanged={(p) => setPlans((prev) => prev.map((x) => (x.id === p.id ? p : x)))}
        />
      )}
    </div>
  );
}
