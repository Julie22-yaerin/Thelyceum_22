/**
 * MissionPyramid — The Lyceum
 *
 * The progress picture for one mission, aimed at someone non-technical.
 *
 *            ┌──────────────────────┐
 *            │  Alex Chen · decides │   ← the person accountable
 *            └──────────┬───────────┘
 *          ┌────────────┼────────────┐
 *      [ step ]     [ step ]     [ step ]   ← who does what, plain status
 *
 * Deliberately plain HTML/CSS rather than a node graph: no pan, no zoom, no
 * dragging, nothing to learn. Every status is written in words ("Working on
 * it", "Stuck") instead of a colour the reader has to decode, and colour is
 * only a reinforcement.
 */

import { Bot, User, Check, Clock, AlertTriangle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  missionProgress,
  STEP_STATUS_LABEL,
  type Mission,
  type MissionStep,
  type StepStatus,
} from "@/store/useMissionStore";

const STEP_STYLE: Record<
  StepStatus,
  { bg: string; ink: string; border: string; icon: React.ElementType }
> = {
  done: { bg: "bg-green-50", ink: "text-green-700", border: "border-green-200", icon: Check },
  doing: { bg: "bg-blue-50", ink: "text-blue-700", border: "border-blue-200", icon: Clock },
  blocked: { bg: "bg-red-50", ink: "text-red-700", border: "border-red-200", icon: AlertTriangle },
  todo: { bg: "bg-ws-subtle", ink: "text-ws-text-muted", border: "border-ws-border", icon: Circle },
};

function StepCard({
  step,
  onCycle,
}: {
  step: MissionStep;
  onCycle?: (next: StepStatus) => void;
}) {
  const style = STEP_STYLE[step.status];
  const StatusIcon = style.icon;
  const OwnerIcon = step.owner.kind === "ai" ? Bot : User;

  // One click walks the step forward — the whole interaction model.
  const NEXT: Record<StepStatus, StepStatus> = {
    todo: "doing",
    doing: "done",
    done: "todo",
    blocked: "doing",
  };

  return (
    <button
      type="button"
      onClick={onCycle ? () => onCycle(NEXT[step.status]) : undefined}
      disabled={!onCycle}
      className={cn(
        "w-full text-left rounded-xl border bg-ws-bg p-3 transition-shadow",
        "border-ws-border",
        onCycle && "hover:shadow-sm cursor-pointer"
      )}
    >
      {/* Who's doing it */}
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium",
            step.owner.kind === "ai"
              ? "bg-purple-50 text-purple-700"
              : "bg-ws-hover text-ws-text-soft"
          )}
        >
          <OwnerIcon className="w-2.5 h-2.5" />
          {step.owner.kind === "ai" ? "AI" : "Person"}
        </span>
        <span className="text-[11px] text-ws-text-soft truncate">{step.owner.name}</span>
      </div>

      {/* What it is */}
      <p className="text-[13px] font-medium text-ws-text leading-snug mb-2">{step.title}</p>

      {/* Status, in words */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border",
            style.bg,
            style.ink,
            style.border
          )}
        >
          <StatusIcon className="w-2.5 h-2.5" />
          {STEP_STATUS_LABEL[step.status]}
        </span>
        {step.owner.kind === "ai" && step.tokensUsed > 0 && (
          <span className="text-[10px] text-ws-text-muted tabular-nums">
            {step.tokensUsed.toLocaleString()} tokens
          </span>
        )}
      </div>

      {step.note && (
        <p className="text-[11px] text-ws-text-muted leading-relaxed mt-2 pt-2 border-t border-ws-border">
          {step.note}
        </p>
      )}
    </button>
  );
}

export default function MissionPyramid({
  mission,
  onStepStatus,
}: {
  mission: Mission;
  onStepStatus?: (stepId: string, status: StepStatus) => void;
}) {
  const progress = missionProgress(mission);
  const doneCount = mission.steps.filter((s) => s.status === "done").length;

  return (
    <div className="w-full">
      {/* ── Head of the pyramid: the accountable person ── */}
      <div className="flex justify-center">
        <div className="rounded-xl border border-ws-border bg-ws-bg px-4 py-3 text-center min-w-[220px] shadow-sm">
          <p className="text-[10px] uppercase tracking-wider text-ws-text-muted mb-1">
            Decision maker
          </p>
          <div className="flex items-center justify-center gap-2">
            <div className="w-6 h-6 rounded-full bg-ws-hover flex items-center justify-center text-[10px] font-semibold text-ws-text-soft shrink-0">
              {mission.headName.charAt(0).toUpperCase()}
            </div>
            <p className="text-sm font-semibold text-ws-text">{mission.headName}</p>
          </div>
          <p className="text-[11px] text-ws-text-muted mt-1.5">
            {doneCount} of {mission.steps.length} steps done · {progress}%
          </p>
          {/* Progress bar — the single number a CEO actually wants */}
          <div className="h-1.5 rounded-full bg-ws-hover mt-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Connector from head down to the row of steps ── */}
      {mission.steps.length > 0 && (
        <div className="flex justify-center" aria-hidden="true">
          <div className="w-px h-5 bg-ws-border" />
        </div>
      )}

      {/* ── The steps ── */}
      {mission.steps.length === 0 ? (
        <p className="text-center text-[12px] text-ws-text-muted py-6">
          No steps yet. Add the first one to start tracking progress.
        </p>
      ) : (
        <>
          {/* Horizontal rail so it reads as one level of the pyramid */}
          <div className="relative" aria-hidden="true">
            <div className="absolute left-[12.5%] right-[12.5%] top-0 h-px bg-ws-border" />
          </div>
          <div className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            {mission.steps.map((step) => (
              <div key={step.id} className="relative">
                {/* little stem up to the rail */}
                <div
                  className="absolute -top-5 left-1/2 w-px h-5 bg-ws-border"
                  aria-hidden="true"
                />
                <StepCard
                  step={step}
                  onCycle={onStepStatus ? (next) => onStepStatus(step.id, next) : undefined}
                />
              </div>
            ))}
          </div>
          {onStepStatus && (
            <p className="text-[11px] text-ws-text-muted text-center mt-4">
              Tip: click any step to move it forward.
            </p>
          )}
        </>
      )}
    </div>
  );
}
