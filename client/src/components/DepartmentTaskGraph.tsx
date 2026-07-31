/**
 * DepartmentTaskGraph — every task in one department, and what blocks what.
 *
 * Laid out left→right by dependency depth: the first column is work that can
 * start now, each column after it is work waiting on the column before. That
 * makes the two questions a department head actually has answerable at a
 * glance — "what can we start today" and "what is everything else waiting on".
 *
 * Plain HTML/CSS with SVG only for the connector lines. No pan, no zoom, no
 * drag. A task graph you have to learn to operate isn't a task graph, it's a
 * second job.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, Circle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  missionProgress,
  MISSION_STATUS_LABEL,
  type Mission,
  type MissionStatus,
} from "@/store/useMissionStore";

const STATUS_STYLE: Record<MissionStatus, { dot: string; chip: string; icon: React.ElementType }> = {
  planning: { dot: "bg-ws-text-muted", chip: "bg-ws-hover text-ws-text-soft border-ws-border", icon: Circle },
  active: { dot: "bg-blue-500", chip: "bg-blue-50 text-blue-700 border-blue-200", icon: Clock },
  review: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  done: { dot: "bg-green-500", chip: "bg-green-50 text-green-700 border-green-200", icon: Check },
  blocked: { dot: "bg-red-500", chip: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle },
};

/**
 * Group tasks into dependency levels. Level 0 = nothing to wait for. A task
 * whose dependency is missing (deleted, or in another department) is treated
 * as level 0 rather than vanishing from the graph — a task you can't see is
 * worse than one drawn slightly early.
 */
function toLevels(missions: Mission[]): Mission[][] {
  const byId = new Map(missions.map((m) => [m.id, m]));
  const level = new Map<string, number>();

  const resolve = (m: Mission, seen: Set<string>): number => {
    if (level.has(m.id)) return level.get(m.id)!;
    // A dependency cycle would otherwise recurse forever; break it and treat
    // the task as startable, which at least keeps the board usable.
    if (seen.has(m.id)) return 0;
    seen.add(m.id);

    const deps = (m.dependsOn ?? []).map((id) => byId.get(id)).filter(Boolean) as Mission[];
    const depth = deps.length === 0 ? 0 : Math.max(...deps.map((d) => resolve(d, seen) + 1));
    level.set(m.id, depth);
    return depth;
  };

  for (const m of missions) resolve(m, new Set());

  const maxLevel = Math.max(0, ...Array.from(level.values()));
  const columns: Mission[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const m of missions) columns[level.get(m.id) ?? 0].push(m);
  return columns;
}

/** A task is startable when everything it depends on is finished. */
function isBlockedByDeps(m: Mission, all: Mission[]): boolean {
  const byId = new Map(all.map((x) => [x.id, x]));
  return (m.dependsOn ?? []).some((id) => {
    const dep = byId.get(id);
    return dep ? missionProgress(dep) < 100 : false;
  });
}

export default function DepartmentTaskGraph({
  missions,
  onOpenTask,
  openTaskId,
}: {
  missions: Mission[];
  onOpenTask?: (missionId: string) => void;
  openTaskId?: string | null;
}) {
  const columns = useMemo(() => toLevels(missions), [missions]);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; dim: boolean }[]>([]);

  // Connector lines are measured from the DOM so they stay correct at any
  // width without hardcoding card sizes.
  useLayoutEffect(() => {
    const measure = () => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return;
      const next: typeof lines = [];
      for (const m of missions) {
        for (const depId of m.dependsOn ?? []) {
          const from = cardRefs.current[depId];
          const to = cardRefs.current[m.id];
          if (!from || !to) continue;
          const a = from.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          next.push({
            x1: a.right - box.left,
            y1: a.top + a.height / 2 - box.top,
            x2: b.left - box.left,
            y2: b.top + b.height / 2 - box.top,
            // Dim the line once the blocker is finished — it's history, not a
            // constraint any more.
            dim: missionProgress(missions.find((x) => x.id === depId)!) === 100,
          });
        }
      }
      setLines(next);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [missions, openTaskId]);

  if (missions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ws-border p-10 text-center">
        <p className="text-sm text-ws-text mb-1">No tasks in this department yet</p>
        <p className="text-[12px] text-ws-text-muted">
          Add the first one and it will appear here, with anything that depends on it.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-ws-border bg-ws-bg p-4 overflow-x-auto">
      <div ref={containerRef} className="relative inline-flex gap-10 min-w-full">
        {/* Connector lines sit behind the cards */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
          {lines.map((l, i) => {
            const midX = (l.x1 + l.x2) / 2;
            return (
              <path
                key={i}
                d={`M ${l.x1} ${l.y1} C ${midX} ${l.y1}, ${midX} ${l.y2}, ${l.x2} ${l.y2}`}
                fill="none"
                stroke={l.dim ? "var(--ws-flow-dot)" : "var(--ws-flow-edge)"}
                strokeWidth={1.5}
                strokeDasharray={l.dim ? "4 4" : undefined}
              />
            );
          })}
        </svg>

        {columns.map((column, colIdx) => (
          <div key={colIdx} className="relative flex flex-col gap-3 min-w-[220px]">
            <p className="text-[10px] uppercase tracking-wider text-ws-text-muted">
              {colIdx === 0 ? "Can start now" : `Waiting on step ${colIdx}`}
            </p>

            {column.map((m) => {
              const progress = missionProgress(m);
              const style = STATUS_STYLE[m.status];
              const StatusIcon = style.icon;
              const waiting = isBlockedByDeps(m, missions);
              const isOpen = m.id === openTaskId;

              return (
                <button
                  key={m.id}
                  ref={(el) => {
                    cardRefs.current[m.id] = el;
                  }}
                  onClick={() => onOpenTask?.(m.id)}
                  className={cn(
                    "relative text-left rounded-xl border bg-ws-bg p-3 transition-shadow",
                    isOpen ? "border-teal shadow-sm" : "border-ws-border hover:shadow-sm"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full mt-1.5 shrink-0", style.dot)} />
                    <p className="flex-1 text-[13px] font-medium text-ws-text leading-snug">
                      {m.title}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border",
                        style.chip
                      )}
                    >
                      <StatusIcon className="w-2.5 h-2.5" />
                      {MISSION_STATUS_LABEL[m.status]}
                    </span>
                    {waiting && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-ws-hover text-ws-text-muted">
                        <Lock className="w-2.5 h-2.5" />
                        waiting
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-ws-hover overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-ws-text-muted tabular-nums">{progress}%</span>
                  </div>

                  <p className="text-[10px] text-ws-text-muted mt-1.5 truncate">
                    {m.headName} · {m.steps.length} step{m.steps.length !== 1 ? "s" : ""}
                  </p>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
