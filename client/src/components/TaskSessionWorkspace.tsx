/**
 * TaskSessionWorkspace — The Lyceum
 *
 * Per-task workspace that shows:
 *   - Current task status and details
 *   - Human output submission form
 *   - AI processing status (awaits human output → triggers automatically)
 *   - Task dependency visualization (what's blocking what)
 *   - Session progress across all tasks
 *
 * Flow:
 *   Human works on task → submits output → AI is triggered with that output
 *   → AI processes → task completes → next ready task becomes active
 */

import { useState, useCallback } from "react";
import {
  Send,
  CheckCircle2,
  Loader2,
  Clock,
  Bot,
  Users,
  ArrowRight,
  ChevronRight,
  ListTodo,
  Sparkles,
  FileText,
  AlertCircle,
  Play,
  Check,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useSessionStore, type SelectedTask } from "@/store/useSessionStore";
import PyramidGraph from "@/components/PyramidGraph";
import TaskApprovalPanel from "@/components/TaskApprovalPanel";
import ClarificationSidebar from "@/components/ClarificationSidebar";

// ── Task Status Badge ────────────────────────────────────────────────────────

function TaskStatusBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; color: string; icon: React.ElementType }> = {
    not_started: { label: "Not Started", color: "text-gray-400 border-gray-500/30 bg-gray-500/10", icon: Clock },
    in_progress: { label: "In Progress", color: "text-blue-400 border-blue-500/30 bg-blue-500/10", icon: Play },
    awaiting_ai: { label: "Awaiting AI", color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: Bot },
    ai_working: { label: "AI Working", color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10", icon: Loader2 },
    completed: { label: "Completed", color: "text-green-400 border-green-500/30 bg-green-500/10", icon: CheckCircle2 },
    blocked: { label: "Blocked", color: "text-red-400 border-red-500/30 bg-red-500/10", icon: AlertCircle },
    awaiting_clarification: { label: "Needs Input", color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: HelpCircle },
    failed: { label: "Failed", color: "text-red-400 border-red-500/30 bg-red-500/10", icon: AlertCircle },
    awaiting_approval: { label: "Needs Approval", color: "text-amber-400 border-amber-500/30 bg-amber-500/10", icon: AlertCircle },
  };
  const m = meta[status] || meta.not_started;
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("text-[10px] h-5 px-2", m.color)}>
      <Icon className="w-3 h-3 mr-1" /> {m.label}
    </Badge>
  );
}

// ── Task Card (for sidebar) ──────────────────────────────────────────────────

function TaskCardItem({ task, isActive, onSelect }: { task: SelectedTask; isActive: boolean; onSelect: () => void }) {
  // Reactive hook for dependency lookups
  const allTasks = useSessionStore((s) => s.currentSession?.tasks || []);
  
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-2.5 py-2 rounded-lg border transition-all",
        isActive
          ? "bg-teal-500/10 border-teal-500/30"
          : "bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10"
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[12px] font-medium text-white/80 truncate flex-1">{task.title}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <TaskStatusBadge status={task.status} />
        <span className="text-[10px] text-muted-foreground">{task.timeframe}m</span>
      </div>
      {/* Dependency arrows */}
      {task.dependsOn.length > 0 && (
        <div className="flex items-center gap-0.5 mt-1 text-[10px] text-muted-foreground">
          <span>after:</span>
          {task.dependsOn.map((depId) => {
            const dep = allTasks.find((t) => t.id === depId);
            return <span key={depId} className="text-amber-400">{dep?.title.slice(0, 12) || "..."}</span>;
          })}
        </div>
      )}
    </button>
  );
}

// ── AI Role Card ─────────────────────────────────────────────────────────────

function AIRoleCard({ role, humanOutput, taskId, taskStatus, existingOutput, onTrigger }: {
  role: { roleName: string; domain: string; requiresHumanOutput: boolean };
  humanOutput?: string;
  taskId: string;
  taskStatus: string;
  existingOutput?: string;
  onTrigger: () => void;
}) {
  const [triggering, setTriggering] = useState(false);

  // Reactively get this role's streaming output from the store
  const liveOutput = useSessionStore(
    (s) => s.currentSession?.tasks.find((t) => t.id === taskId)?.aiOutputs?.[role.roleName] || ""
  );

  const isStreaming = taskStatus === "ai_working" && liveOutput && liveOutput.length > 0;

  const handleTrigger = async () => {
    setTriggering(true);
    await onTrigger();
    setTriggering(false);
  };

  // Determine display state
  const hasLiveOutput = isStreaming || (existingOutput && existingOutput.length > 0);
  const displayText = liveOutput || existingOutput || "";

  return (
    <div className={cn(
      "rounded-lg p-2.5 border transition-all",
      isStreaming
        ? "bg-cyan-500/10 border-cyan-500/30"
        : hasLiveOutput
          ? "bg-green-500/5 border-green-500/10"
          : "bg-cyan-500/5 border-cyan-500/10"
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Bot className={cn(
            "w-3 h-3",
            isStreaming ? "text-cyan-300 animate-pulse" : "text-cyan-400"
          )} />
          <span className="text-[12px] font-medium text-white/80">{role.roleName}</span>
          {isStreaming && (
            <span className="text-[9px] text-cyan-400 animate-pulse">streaming...</span>
          )}
        </div>
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-cyan-400 border-cyan-500/20">
          {role.domain}
        </Badge>
      </div>

      {/* Streaming or completed output */}
      {displayText && (
        <div className="mb-2 bg-[#08080c] border border-white/5 rounded p-2 max-h-[120px] overflow-y-auto">
          <p className="text-[11px] text-white/70 whitespace-pre-wrap leading-relaxed">
            {displayText}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-cyan-400 ml-0.5 animate-pulse" />
            )}
          </p>
        </div>
      )}

      {role.requiresHumanOutput && !humanOutput ? (
        <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
          <Clock className="w-3 h-3" />
          Waiting for human output...
        </div>
      ) : role.requiresHumanOutput && humanOutput && !displayText ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-green-400">
            <Check className="w-3 h-3" /> Human output ready
          </div>
          <Button
            size="sm"
            className="h-8 text-[10px] px-3 bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30"
            onClick={handleTrigger}
            disabled={triggering}
          >
            {triggering ? (
              <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing...</>
            ) : (
              <><Play className="w-3 h-3 mr-1" /> Trigger AI</>
            )}
          </Button>
        </div>
      ) : hasLiveOutput ? (
        <div className="flex items-center gap-1.5 text-[10px]">
          {isStreaming ? (
            <span className="text-cyan-400 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Receiving response...
            </span>
          ) : (
            <span className="text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" /> Complete
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <CheckCircle2 className="w-3 h-3 text-green-400" /> AI will start automatically
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function TaskSessionWorkspace() {
  // Narrow selectors — avoid subscribing to the entire store so unrelated
  // updates (sessions, serverSyncStatus, autoAnswerAuditLog, etc.) don't
  // trigger a full workspace re-render and cascade into an infinite loop.
  const currentSession = useSessionStore((s) => s.currentSession);
  const submitHumanOutput = useSessionStore((s) => s.submitHumanOutput);
  const completeTask = useSessionStore((s) => s.completeTask);
  const triggerAITask = useSessionStore((s) => s.triggerAITask);
  const setActiveTask = useSessionStore((s) => s.setActiveTask);

  const [humanOutput, setHumanOutput] = useState("");
  const [submittingForTask, setSubmittingForTask] = useState<string | null>(null);

  if (!currentSession) return null;

  const { tasks, activeTaskId } = currentSession;
  const activeTask = tasks.find((t) => t.id === activeTaskId) || tasks[0];
  // Reactive: compute ready tasks from store
  const readyTasks = useSessionStore((s) =>
    s.currentSession?.tasks.filter((t) => {
      if (t.status !== "not_started") return false;
      return t.dependsOn.every((depId) =>
        s.currentSession?.tasks.find((x) => x.id === depId)?.status === "completed"
      );
    }) || []
  );
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const aiCount = tasks.reduce((s, t) => s + t.assignedAIs.length, 0);
  const totalMinutes = tasks.reduce((s, t) => s + (parseInt(t.timeframe) || 30), 0);

  const handleSubmitHumanOutput = async () => {
    if (!activeTask || !humanOutput.trim()) return;
    setSubmittingForTask(activeTask.id);
    
    // Submit human output — this marks the human part as complete
    submitHumanOutput(activeTask.id, humanOutput.trim());
    
    // If this task has AI roles that don't require manual trigger, auto-trigger
    const autoAIs = activeTask.assignedAIs.filter((ai) => !ai.requiresHumanOutput);
    for (const ai of autoAIs) {
      await triggerAITask(activeTask.id);
    }
    
    setHumanOutput("");
    setSubmittingForTask(null);
    
    // Move to next ready task if there is one — read fresh state
    const currentState = useSessionStore.getState();
    const session = currentState.currentSession;
    const nextReady = session?.tasks.filter((t) => {
      if (t.status !== "not_started" && t.status !== "in_progress") return false;
      return t.dependsOn.every((depId) =>
        session.tasks.find((x) => x.id === depId)?.status === "completed"
      );
    }) || [];
    if (nextReady.length > 0) {
      setActiveTask(nextReady[0].id);
    }
  };

  const handleManualTriggerAI = async (taskId: string) => {
    await triggerAITask(taskId);
    // Check if this completes the task
    completeTask(taskId);
  };

  if (!activeTask) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto mb-2" />
          <p className="text-sm text-white/70 font-medium">All tasks complete!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-[#08080c]">
      {/* Left: Task List */}
      <div className="w-[320px] border-r border-white/5 bg-[#0a0a0e] flex flex-col">
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2 mb-1.5">
            <ListTodo className="w-4 h-4 text-teal-400" />
            <h3 className="text-[12px] font-medium text-white/90">Session Tasks</h3>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{completedCount}/{tasks.length} done</span>
            <span>·</span>
            <span>{aiCount} AI agents</span>
            <span>·</span>
            <span>{totalMinutes}m total</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-white/5 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-teal-400 rounded-full transition-all duration-500"
              style={{ width: `${(completedCount / tasks.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Approval notifications */}
        <TaskApprovalPanel />

        {/* Clarification questions sidebar */}
        <ClarificationSidebar />

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {tasks.map((task) => (
              <TaskCardItem
                key={task.id}
                task={task}
                isActive={task.id === activeTask.id}
                onSelect={() => setActiveTask(task.id)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Active Task Workspace */}
      <div className="flex-1 flex flex-col">
        {/* Task header */}
        <div className="px-4 py-3 border-b border-white/5 bg-[#0a0a0e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">{activeTask.title}</h2>
              <TaskStatusBadge status={activeTask.status} />
            </div>
            <span className="text-[9px] text-muted-foreground">
              Est. {activeTask.timeframe}m · Order {activeTask.order}/{tasks.length}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{activeTask.description}</p>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main work area */}
          <div className="flex-1 p-4 overflow-y-auto">
            {/* Task input / work area */}
            <div className="space-y-4">
              {/* Human work area */}
              {activeTask.status !== "completed" ? (
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Users className="w-4 h-4 text-amber-400" />
                    <h3 className="text-[14px] font-semibold text-white/80">Your Work</h3>
                    {activeTask.status === "in_progress" || activeTask.status === "not_started" ? (
                      <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/20">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/20">Submitted</Badge>
                    )}
                  </div>

                  {activeTask.status === "awaiting_ai" || activeTask.status === "ai_working" ? (
                    <div className="flex items-center gap-2 text-[10px] text-cyan-400 bg-cyan-500/5 border border-cyan-500/10 rounded-lg p-3">
                      <Bot className="w-4 h-4" />
                      Your output has been submitted. AI agents are processing...
                    </div>
                  ) : (
                    <>
                      <Textarea
                        value={humanOutput}
                        onChange={(e) => setHumanOutput(e.target.value)}
                        placeholder="Describe your work output, findings, or deliverables here. This will be sent to the assigned AI agents as input..."
                        className="h-40 text-[13px] bg-white/5 border-white/10 text-white resize-none"
                      />
                      <div className="flex justify-between items-center mt-2">
                        <p className="text-[10px] text-muted-foreground">
                          {activeTask.assignedAIs.length > 0
                            ? "Submit to trigger assigned AI agents"
                            : "Mark this task as complete"}
                        </p>
                        <Button
                          size="sm"
                          className="h-9 text-[11px] px-4 bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30"
                          onClick={handleSubmitHumanOutput}
                          disabled={!humanOutput.trim() || submittingForTask !== null}
                        >
                          {submittingForTask === activeTask.id ? (
                            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Submitting...</>
                          ) : (
                            <><Send className="w-3.5 h-3.5 mr-1.5" /> Submit Output</>
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-[10px] text-green-400 bg-green-500/5 border border-green-500/10 rounded-lg p-3">
                    <CheckCircle2 className="w-4 h-4" />
                    Task complete!
                  </div>
                </div>
              )}

              {/* AI agents assigned to this task */}
              {activeTask.assignedAIs.length > 0 && (
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Bot className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-[14px] font-semibold text-white/80">AI Agents</h3>
                    <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/20">{activeTask.assignedAIs.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {activeTask.assignedAIs.map((ai) => (
                      <AIRoleCard
                        key={ai.roleName}
                        role={ai}
                        humanOutput={activeTask.humanOutput}
                        taskId={activeTask.id}
                        taskStatus={activeTask.status}
                        existingOutput={activeTask.aiOutputs?.[ai.roleName]}
                        onTrigger={() => handleManualTriggerAI(activeTask.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Workflow Graph */}
          <div className="w-[420px] border-l border-white/5 bg-[#08080c]">
            <div className="px-3 py-2 border-b border-white/5 bg-[#0a0a0e]">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Workflow Graph</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                Click any node to switch tasks · Drag to rearrange
              </p>
            </div>
            <div className="h-[calc(100%-32px)]">
              <PyramidGraph
                tasks={tasks}
                activeTaskId={activeTask.id}
                onSelectTask={(taskId) => setActiveTask(taskId)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
