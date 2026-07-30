/**
 * TaskOnboarding — The Lyceum
 *
 * The full onboarding flow before users enter the workspace:
 *   1. Platform Selection (clipped-video-tab style)
 *   2. Task Selection — choose from AI-suggested tasks or create custom ones
 *   3. AI Role Assignment — assign AI agents by role to serve each task
 *   4. Timeframe & Dependency Configuration
 *   5. Confirm → Enter per-task workspace
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Plus,
  X,
  Bot,
  Zap,
  Sparkles,
  ChevronRight,
  Play,
  Link2,
  Database, Mic, Brain, Globe, Code2,
  TrendingUp, Headphones, Bug, Palette, Cpu,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useSessionStore, SUGGESTED_TASKS, AVAILABLE_AI_ROLES, type SelectedTask, type TaskCategory } from "@/store/useSessionStore";
import ClippedVideoTab from "@/components/ui/clipped-video-tab";

// ── Category Icons ───────────────────────────────────────────────────────────

const CATEGORY_META: Record<TaskCategory, { icon: React.ElementType; color: string; label: string }> = {
  data_annotation: { icon: Zap, color: "text-amber-700", label: "Data Annotation" },
  data_collection: { icon: Database, color: "text-blue-700", label: "Data Collection" },
  audio_speech: { icon: Mic, color: "text-purple-700", label: "Audio & Speech" },
  explainable_ai: { icon: Brain, color: "text-teal-700", label: "Explainable AI" },
  content_generation: { icon: Globe, color: "text-green-700", label: "Content Gen" },
  code_development: { icon: Code2, color: "text-cyan-700", label: "Development" },
  market_research: { icon: TrendingUp, color: "text-indigo-700", label: "Market Research" },
  customer_support: { icon: Headphones, color: "text-pink-700", label: "Support" },
  qa_testing: { icon: Bug, color: "text-red-700", label: "QA Testing" },
  design: { icon: Palette, color: "text-rose-700", label: "Design" },
  operations: { icon: Cpu, color: "text-orange-700", label: "Operations" },
  custom: { icon: Plus, color: "text-ws-text-soft", label: "Custom" },
};

// ── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all",
            i < current
              ? "bg-teal-100 text-teal-700"
              : i === current
                ? "bg-teal-100 text-teal-200 border border-teal-200"
                : "text-muted-foreground bg-ws-subtle"
          )}>
            {i < current ? <Check className="w-2.5 h-2.5" /> : <span>{i + 1}</span>}
            {step}
          </div>
          {i < steps.length - 1 && <div className="w-6 h-px bg-ws-hover" />}
        </div>
      ))}
    </div>
  );
}

// ── Platform Select Step ─────────────────────────────────────────────────────

function PlatformSelectStep({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ws-text mb-2">Choose Your Platform</h1>
        <p className="text-sm text-muted-foreground">
          Select the type of work you want to accomplish. Each platform comes with pre-configured AI agents and workflows.
        </p>
      </div>
      <div className="rounded-xl overflow-hidden border border-ws-border bg-ws-bg">
        <ClippedVideoTab />
      </div>
      <div className="flex justify-end mt-6">
        <Button
          className="h-8 text-[10px] px-4 bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
          onClick={onNext}
        >
          Continue to Task Setup
          <ArrowRight className="w-3 h-3 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Task Select Step ─────────────────────────────────────────────────────────

function TaskSelectStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { currentSession, addTask, removeTask } = useSessionStore();
  const [search, setSearch] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const [customCategory, setCustomCategory] = useState<TaskCategory>("custom");

  const tasks = currentSession?.tasks || [];
  const taskIds = new Set(tasks.map((t) => t.title));

  const filteredSuggestions = SUGGESTED_TASKS.filter(
    (s) => !taskIds.has(s.title) && s.title.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddSuggested = (suggestion: typeof SUGGESTED_TASKS[0]) => {
    addTask({
      title: suggestion.title,
      category: suggestion.category,
      description: suggestion.description,
      source: "ai_suggested",
      timeframe: "30",
      estimatedMinutes: 30,
      assignedAIs: [],
    });
  };

  const handleAddCustom = () => {
    if (!customTitle.trim()) return;
    addTask({
      title: customTitle.trim(),
      category: customCategory,
      description: customDesc.trim() || "Custom task",
      source: "custom",
      timeframe: "30",
      estimatedMinutes: 30,
      assignedAIs: [],
    });
    setCustomTitle("");
    setCustomDesc("");
    setShowCustomForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-ws-text">Select Your Tasks</h1>
          <p className="text-[11px] text-muted-foreground">
            Choose from AI-suggested tasks or create your own. Set timeframes and assign AI agents.
          </p>
        </div>
        <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-200">
          {tasks.length} selected
        </Badge>
      </div>

      {/* Selected tasks */}
      {tasks.length > 0 && (
        <div className="mb-4 space-y-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Selected Tasks</p>
          {tasks.map((task) => {
            const meta = CATEGORY_META[task.category] || CATEGORY_META.custom;
            const Icon = meta.icon;
            return (
              <div key={task.id} className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                <Icon className={cn("w-3 h-3 shrink-0", meta.color)} />
                <span className="text-[10px] text-ws-text flex-1 truncate">{task.title}</span>
                <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-muted-foreground border-ws-border">
                  {task.source === "ai_suggested" ? "AI" : "Custom"}
                </Badge>
                <button onClick={() => removeTask(task.id)} className="text-muted-foreground hover:text-red-800">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tasks..."
        className="h-7 text-[10px] bg-ws-subtle border-ws-border text-ws-text mb-3"
      />

      {/* AI-suggested tasks grid */}
      {filteredSuggestions.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {filteredSuggestions.map((suggestion, i) => {
            const meta = CATEGORY_META[suggestion.category] || CATEGORY_META.custom;
            const Icon = meta.icon;
            return (
              <button
                key={i}
                onClick={() => handleAddSuggested(suggestion)}
                className="text-left bg-ws-subtle border border-ws-border rounded-lg p-2.5 hover:bg-ws-hover hover:border-teal-200 transition-all group"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn("w-3 h-3", meta.color)} />
                  <span className="text-[9px] font-medium text-ws-text truncate flex-1">{suggestion.title}</span>
                  <Plus className="w-2.5 h-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <p className="text-[8px] text-muted-foreground line-clamp-2">{suggestion.description}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom task button */}
      {!showCustomForm ? (
        <button
          onClick={() => setShowCustomForm(true)}
          className="w-full py-2 border border-dashed border-ws-border rounded-lg text-[10px] text-muted-foreground hover:text-ws-text hover:border-ws-border transition-colors"
        >
          <Plus className="w-3 h-3 inline mr-1" /> Create Custom Task
        </button>
      ) : (
        <div className="bg-ws-subtle border border-ws-border rounded-lg p-3 space-y-2">
          <Input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="Task title" className="h-7 text-[10px] bg-ws-subtle border-ws-border text-ws-text" />
          <Textarea value={customDesc} onChange={(e) => setCustomDesc(e.target.value)}
            placeholder="Description" className="h-14 text-[10px] bg-ws-subtle border-ws-border text-ws-text resize-none" />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 text-[8px] px-2 bg-teal-100 text-teal-700 border border-teal-200"
              onClick={handleAddCustom} disabled={!customTitle.trim()}>
              <Plus className="w-2 h-2 mr-0.5" /> Add
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[8px] text-muted-foreground hover:text-ws-text"
              onClick={() => setShowCustomForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <Button variant="ghost" className="h-7 text-[9px] text-muted-foreground hover:text-ws-text" onClick={onBack}>
          <ArrowLeft className="w-3 h-3 mr-1" /> Back
        </Button>
        <Button className="h-7 text-[9px] px-3 bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
          onClick={onNext} disabled={tasks.length === 0}>
          Configure AI Agents <ArrowRight className="w-3 h-3 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── AI Assign Step ───────────────────────────────────────────────────────────

function AIAssignStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { currentSession, updateTaskTimeframe, assignAIToTask, removeAITask, addTaskDependency, removeTaskDependency } = useSessionStore();
  const tasks = currentSession?.tasks || [];
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const handleAssign = (taskId: string, aiRole: typeof AVAILABLE_AI_ROLES[0]) => {
    assignAIToTask(taskId, {
      ...aiRole,
      agentNodeId: `agent-${Math.floor(Math.random() * 6) + 1}`,
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-ws-text">Configure AI Agents</h1>
          <p className="text-[11px] text-muted-foreground">
            Set timeframes and assign AI agents by role to each task. AI agents will process their part once human output is ready.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {tasks.map((task) => {
          const meta = CATEGORY_META[task.category] || CATEGORY_META.custom;
          const Icon = meta.icon;
          const isExpanded = expandedTask === task.id;

          return (
            <div key={task.id} className="bg-ws-subtle border border-ws-border rounded-lg overflow-hidden">
              {/* Task header */}
              <button
                onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
              >
                <Icon className={cn("w-3.5 h-3.5 shrink-0", meta.color)} />
                <span className="text-[10px] text-ws-text flex-1 truncate">{task.title}</span>
                <div className="flex items-center gap-1.5">
                  {task.assignedAIs.length > 0 && (
                    <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-cyan-700 border-cyan-200">
                      <Bot className="w-2 h-2 mr-0.5" /> {task.assignedAIs.length}
                    </Badge>
                  )}
                  <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                </div>
              </button>

              {/* Expanded config */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-ws-border pt-2">
                  {/* Timeframe */}
                  <div>
                    <label className="text-[7px] text-muted-foreground uppercase tracking-wider">Timeframe (minutes)</label>
                    <Input
                      value={task.timeframe}
                      onChange={(e) => updateTaskTimeframe(task.id, e.target.value)}
                      type="number"
                      min={5}
                      className="h-6 text-[9px] bg-ws-subtle border-ws-border text-ws-text mt-0.5"
                    />
                  </div>

                  {/* AI Roles */}
                  <div>
                    <label className="text-[7px] text-muted-foreground uppercase tracking-wider mb-1 block">
                      Assigned AI Roles
                    </label>
                    {task.assignedAIs.length > 0 && (
                      <div className="space-y-1 mb-1.5">
                        {task.assignedAIs.map((ai) => (
                          <div key={ai.roleName} className="flex items-center gap-1.5 bg-cyan-50 border border-cyan-200 rounded px-2 py-1">
                            <Bot className="w-2.5 h-2.5 text-cyan-700" />
                            <span className="text-[9px] text-ws-text-soft flex-1">{ai.roleName}</span>
                            {ai.requiresHumanOutput && (
                              <Badge variant="outline" className="text-[6px] h-3 px-1 text-amber-700 border-amber-200">
                                needs human
                              </Badge>
                            )}
                            <button onClick={() => removeAITask(task.id, ai.roleName)}
                              className="text-muted-foreground hover:text-red-800">
                              <X className="w-2 h-2" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {AVAILABLE_AI_ROLES.filter(
                        (r) => !task.assignedAIs.some((a) => a.roleName === r.roleName)
                      ).map((role) => (
                        <button
                          key={role.roleName}
                          onClick={() => handleAssign(task.id, role)}
                          className="px-1.5 py-0.5 rounded text-[8px] border border-ws-border text-muted-foreground hover:text-cyan-800 hover:border-cyan-200 transition-colors"
                        >
                          <Bot className="w-2 h-2 inline mr-0.5" />
                          {role.roleName}
                          {role.requiresHumanOutput && " ⏳"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dependencies */}
                  <div>
                    <label className="text-[7px] text-muted-foreground uppercase tracking-wider mb-1 block">
                      <Link2 className="w-2.5 h-2.5 inline mr-0.5" /> Depends On
                    </label>
                    {task.dependsOn.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {task.dependsOn.map((depId) => {
                          const dep = tasks.find((t) => t.id === depId);
                          return (
                            <span key={depId}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] bg-amber-50 text-amber-700 border border-amber-200"
                            >
                              {dep?.title || "..."}
                              <button onClick={() => removeTaskDependency(task.id, depId)}
                                className="hover:text-red-800">
                                <X className="w-2 h-2" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {tasks.filter((t) => t.id !== task.id && !task.dependsOn.includes(t.id)).map((t) => (
                        <button
                          key={t.id}
                          onClick={() => addTaskDependency(task.id, t.id)}
                          className="px-1.5 py-0.5 rounded text-[7px] border border-ws-border text-muted-foreground hover:text-amber-800 hover:border-amber-200 transition-colors"
                        >
                          + {t.title.slice(0, 20)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <Button variant="ghost" className="h-7 text-[9px] text-muted-foreground hover:text-ws-text" onClick={onBack}>
          <ArrowLeft className="w-3 h-3 mr-1" /> Back
        </Button>
        <Button className="h-7 text-[9px] px-3 bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
          onClick={onNext}>
          Review & Confirm <ArrowRight className="w-3 h-3 ml-1" />
        </Button>
      </div>
    </div>
  );
}

// ── Confirm Step ─────────────────────────────────────────────────────────────

function ConfirmStep({ onBack, onConfirm }: { onBack: () => void; onConfirm: () => void }) {
  const { currentSession } = useSessionStore();
  const tasks = currentSession?.tasks || [];
  const aiCount = tasks.reduce((s, t) => s + t.assignedAIs.length, 0);
  const totalMinutes = tasks.reduce((s, t) => s + (parseInt(t.timeframe) || 30), 0);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-bold text-ws-text">Review Your Session</h1>
        <p className="text-[11px] text-muted-foreground">
          Confirm your task selection, AI assignments, and workflow before entering the workspace.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-indigo-700">{tasks.length}</p>
          <p className="text-[8px] text-muted-foreground">Tasks</p>
        </div>
        <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-cyan-700">{aiCount}</p>
          <p className="text-[8px] text-muted-foreground">AI Agents</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-center">
          <p className="text-lg font-bold text-amber-700">{totalMinutes}m</p>
          <p className="text-[8px] text-muted-foreground">Total Est.</p>
        </div>
      </div>

      {/* Task list summary */}
      <div className="space-y-1.5 mb-4">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Workflow</p>
        {tasks.map((task, i) => {
          const meta = CATEGORY_META[task.category] || CATEGORY_META.custom;
          const Icon = meta.icon;
          return (
            <div key={task.id} className="flex items-center gap-2 bg-ws-subtle border border-ws-border rounded-lg px-3 py-2">
              <span className="text-[8px] text-muted-foreground w-4">{i + 1}.</span>
              <Icon className={cn("w-3 h-3 shrink-0", meta.color)} />
              <span className="text-[10px] text-ws-text flex-1 truncate">{task.title}</span>
              <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-muted-foreground border-ws-border">
                {task.timeframe}m
              </Badge>
              {task.assignedAIs.map((ai) => (
                <Badge key={ai.roleName} variant="outline" className="text-[7px] h-3.5 px-1 text-cyan-700 border-cyan-200">
                  <Bot className="w-2 h-2 mr-0.5" />{ai.roleName.split(" ")[0]}
                </Badge>
              ))}
            </div>
          );
        })}
      </div>

      {/* Workflow visualization */}
      <div className="bg-ws-subtle border border-ws-border rounded-lg p-3 mb-4">
        <p className="text-[8px] text-muted-foreground uppercase tracking-wider mb-2">Workflow Flow</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {tasks.map((task, i) => (
            <div key={task.id} className="flex items-center gap-1.5">
              <div className={cn(
                "px-2 py-1 rounded text-[8px] font-medium",
                task.assignedAIs.length > 0
                  ? "bg-cyan-50 text-cyan-700 border border-cyan-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              )}>
                {task.assignedAIs.length > 0 ? "🤖" : "👤"} {task.title.slice(0, 20)}
              </div>
              {i < tasks.length - 1 && <ChevronRight className="w-2.5 h-2.5 text-muted-foreground" />}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[8px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> Human</span>
          <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-cyan-400" /> AI</span>
          <span className="text-muted-foreground">— AI triggers after human completes</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="ghost" className="h-7 text-[9px] text-muted-foreground hover:text-ws-text" onClick={onBack}>
          <ArrowLeft className="w-3 h-3 mr-1" /> Back
        </Button>
        <Button className="h-8 text-[10px] px-4 bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
          onClick={onConfirm}>
          <Play className="w-3 h-3 mr-1" /> Start Working
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function TaskOnboarding() {
  const { step, setStep, createSession, confirmSession } = useSessionStore();
  const [, setLocation] = useLocation();

  const steps = ["Platform", "Tasks", "AI Agents", "Confirm"];

  const handleNext = () => {
    if (step === "platform_select") {
      createSession("My Session");
    } else if (step === "task_select") {
      setStep("ai_assign");
    } else if (step === "ai_assign") {
      setStep("confirm");
    }
  };

  const handleBack = () => {
    if (step === "task_select") setStep("platform_select");
    else if (step === "ai_assign") setStep("task_select");
    else if (step === "confirm") setStep("ai_assign");
  };

  const handleConfirm = () => {
    // Use the server-syncing confirm if available, fallback to local
    const store = useSessionStore.getState();
    if (store.confirmSessionAndSync) {
      store.confirmSessionAndSync();
    } else {
      store.confirmSession();
    }
    setLocation("/session");
  };

  const stepIndex = steps.indexOf(
    step === "platform_select" ? "Platform" :
    step === "task_select" ? "Tasks" :
    step === "ai_assign" ? "AI Agents" : "Confirm"
  );

  return (
    <div className="min-h-screen bg-ws-subtle">
      {/* Header */}
      <div className="border-b border-ws-border bg-ws-bg/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-teal-100 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-teal-700" />
            </div>
            <span className="text-xs font-semibold text-ws-text">The Lyceum</span>
          </div>
          <button
            onClick={() => setLocation("/canvas")}
            className="text-[10px] text-muted-foreground hover:text-ws-text transition-colors"
          >
            Skip to Canvas
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Step indicator */}
        {step !== "platform_select" && <StepIndicator current={stepIndex} steps={steps} />}

        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            {step === "platform_select" && <PlatformSelectStep onNext={handleNext} />}
            {step === "task_select" && <TaskSelectStep onBack={handleBack} onNext={handleNext} />}
            {step === "ai_assign" && <AIAssignStep onBack={handleBack} onNext={handleNext} />}
            {step === "confirm" && <ConfirmStep onBack={handleBack} onConfirm={handleConfirm} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
