/**
 * SystemGraph — the whole operation on one screen.
 *
 *                         [ Company ]
 *              ┌───────────────┼───────────────┐
 *        [ Marketing ]   [ Engineering ]  [ Sales ]     ← departments, each
 *         head · 3 tasks   head · 1 task    head · 0       with its own head
 *         🤖 Draft Bot     🤖 Reviewer      —              and its AI
 *         ▓▓▓▓▓░░ 60%      ▓░░░░░░ 12%      ░░░░░░ 0%
 *
 * The dashboard's task graph answers "how is the company doing"; the
 * department's answers "what do we do next". Both are needed — a single graph
 * that tried to do both would be unreadable at either level.
 *
 * Rendered as plain HTML with one SVG layer for the connectors, measured from
 * the DOM so it stays correct at any width.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { Bot, Crown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { missionProgress, type AiWorker, type Mission } from "@/store/useMissionStore";
import type { WorkRole } from "@/lib/workCollaborationTypes";
import { ROLE_ICONS } from "@/lib/workCollaborationTypes";

export interface SystemDepartment {
  role: WorkRole;
  headName: string;
  missions: Mission[];
  workers: AiWorker[];
}

export default function SystemGraph({
  companyName,
  departments,
  onOpenDepartment,
}: {
  companyName: string;
  departments: SystemDepartment[];
  onOpenDepartment: (roleId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const box = containerRef.current?.getBoundingClientRect();
      const root = rootRef.current?.getBoundingClientRect();
      if (!box || !root) return;
      const next: typeof lines = [];
      for (const d of departments) {
        const el = cardRefs.current[d.role.id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        next.push({
          x1: root.left + root.width / 2 - box.left,
          y1: root.bottom - box.top,
          x2: r.left + r.width / 2 - box.left,
          y2: r.top - box.top,
        });
      }
      setLines(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [departments]);

  if (departments.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
        {lines.map((l, i) => {
          const midY = (l.y1 + l.y2) / 2;
          return (
            <path
              key={i}
              d={`M ${l.x1} ${l.y1} C ${l.x1} ${midY}, ${l.x2} ${midY}, ${l.x2} ${l.y2}`}
              fill="none"
              stroke="var(--ws-flow-edge)"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      {/* Company */}
      <div className="flex justify-center mb-8">
        <div
          ref={rootRef}
          className="rounded-xl border border-ws-border bg-ws-bg px-4 py-2.5 text-center shadow-sm"
        >
          <p className="text-[10px] uppercase tracking-wider text-ws-text-muted">Company</p>
          <p className="text-sm font-semibold text-ws-text">{companyName}</p>
        </div>
      </div>

      {/* Departments */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {departments.map((d) => {
          const progress =
            d.missions.length === 0
              ? 0
              : Math.round(
                  d.missions.reduce((sum, m) => sum + missionProgress(m), 0) / d.missions.length
                );
          const blocked = d.missions.filter((m) => m.status === "blocked").length;
          const busy = d.missions.some((m) => m.steps.some((s) => s.status === "doing"));

          return (
            <button
              key={d.role.id}
              ref={(el) => {
                cardRefs.current[d.role.id] = el;
              }}
              onClick={() => onOpenDepartment(d.role.id)}
              className="text-left rounded-xl border border-ws-border bg-ws-bg p-3.5 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2 min-w-0">
                <span className="text-lg shrink-0">{ROLE_ICONS[d.role.icon] ?? "💼"}</span>
                <p className="text-sm font-semibold text-ws-text truncate flex-1">{d.role.name}</p>
                {busy && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"
                    title="Work in progress"
                  />
                )}
              </div>

              {/* People */}
              <div className="flex items-center gap-1.5 text-[11px] text-ws-text-soft mb-1.5">
                <Crown className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="truncate">{d.headName}</span>
              </div>

              {/* AI in this department */}
              {d.workers.length === 0 ? (
                <p className="text-[11px] text-ws-text-muted mb-2">No AI connected</p>
              ) : (
                <div className="flex flex-wrap gap-1 mb-2">
                  {d.workers.slice(0, 4).map((w) => (
                    <span
                      key={w.id}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px]"
                      title={`${w.name} — ${w.tokensUsed.toLocaleString()} tokens`}
                    >
                      <Bot className="w-2.5 h-2.5" />
                      {w.name}
                    </span>
                  ))}
                  {d.workers.length > 4 && (
                    <span className="text-[10px] text-ws-text-muted px-1 py-0.5">
                      +{d.workers.length - 4}
                    </span>
                  )}
                </div>
              )}

              {/* Work */}
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-ws-text-muted">
                  {d.missions.length === 0
                    ? "No tasks"
                    : `${d.missions.length} task${d.missions.length !== 1 ? "s" : ""}`}
                </span>
                {d.missions.length > 0 && (
                  <span className="text-ws-text tabular-nums">{progress}%</span>
                )}
              </div>
              <div className="h-1.5 rounded-full bg-ws-hover overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    blocked > 0 ? "bg-red-500" : "bg-green-500"
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              {blocked > 0 && (
                <p className="text-[10px] text-red-700 mt-1.5">
                  {blocked} stuck — needs a person
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
