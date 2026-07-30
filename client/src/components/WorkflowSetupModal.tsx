/**
 * WorkflowSetupModal — The Lyceum
 *
 * Modal that accepts a short task description + context, calls the Organizer AI
 * (KIMI 3) to generate a full optimized workflow, then displays it for
 * human-in-the-loop configuration before execution.
 */

import { useState } from "react";
import {
  X,
  Sparkles,
  Loader2,
  Brain,
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  Users,
  Bot,
  ChevronDown,
  ChevronRight,
  Shield,
  Target,
  Sliders,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useWorkforceStore } from "@/store/useWorkforceStore";
import { generateWorkflow, generateMockWorkflow, executeWorkflow } from "@/lib/aiTaskGenerator";
import type { GeneratedWorkflow, TaskNode } from "@/lib/aiTaskGenerator";
import TaskConfigPanel from "@/components/TaskConfigPanel";

// ── Task Node Card ───────────────────────────────────────────────────────────

function TaskNodeCard({ node, index, onConfigure }: { node: TaskNode; index: number; onConfigure?: (node: TaskNode) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-ws-border rounded-lg overflow-hidden bg-ws-subtle hover:border-ws-border transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <div className={cn(
          "w-5 h-5 rounded flex items-center justify-center text-[8px] font-bold shrink-0",
          node.allocation.assigneeType === "AI"
            ? "bg-cyan-100 text-cyan-700"
            : "bg-amber-100 text-amber-700"
        )}>
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium text-ws-text truncate">{node.title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {node.allocation.assigneeType === "AI" ? (
              <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-cyan-700 border-cyan-200">
                <Bot className="w-2 h-2 mr-0.5" /> {node.allocation.defaultModel?.split("/").pop() || "AI"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[7px] h-3.5 px-1 text-amber-700 border-amber-200">
                <Users className="w-2 h-2 mr-0.5" /> {node.allocation.humanRoleName || "Human"}
              </Badge>
            )}
            <span className="text-[7px] text-muted-foreground">{node.estimatedDurationMinutes}m</span>
            {node.schedule.estimatedCost > 0 && (
              <span className="text-[7px] text-muted-foreground">${node.schedule.estimatedCost.toFixed(2)}</span>
            )}
          </div>
        </div>
        <Badge variant="outline" className={cn(
          "text-[7px] h-3.5 px-1",
          node.kpi.minimumQualityThreshold >= 90
            ? "text-green-700 border-green-200"
            : node.kpi.minimumQualityThreshold >= 80
              ? "text-amber-700 border-amber-200"
              : "text-muted-foreground border-ws-border"
        )}>
          {node.kpi.minimumQualityThreshold}%
        </Badge>
        {expanded ? <ChevronDown className="w-2.5 h-2.5 text-muted-foreground" /> : <ChevronRight className="w-2.5 h-2.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[9px] text-ws-text-muted leading-relaxed">{node.description}</p>

          {/* Dependencies */}
          {node.dependsOn.length > 0 && (
            <div className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <span>Depends on:</span>
              {node.dependsOn.map((d, i) => (
                <Badge key={d} variant="outline" className="text-[7px] h-3 px-1 text-amber-700 border-amber-200">
                  Step {i + 1}
                </Badge>
              ))}
            </div>
          )}

          {/* Schedule */}
          <div className="bg-ws-subtle rounded px-2 py-1.5">
            <div className="flex items-center gap-1 mb-0.5">
              <Clock className="w-2.5 h-2.5 text-indigo-700" />
              <span className="text-[8px] text-indigo-700 font-medium">Schedule</span>
            </div>
            <p className="text-[8px] text-ws-text-muted">{node.schedule.rationale}</p>
            {node.schedule.suggestedBlocks.length > 0 && (
              <div className="flex gap-1 mt-0.5">
                {node.schedule.suggestedBlocks.map((b) => (
                  <Badge key={b} variant="outline" className="text-[7px] h-3 px-1 text-muted-foreground border-ws-border">{b}</Badge>
                ))}
              </div>
            )}
          </div>

          {/* KPI */}
          <div className="bg-ws-subtle rounded px-2 py-1.5">
            <div className="flex items-center gap-1 mb-0.5">
              <Target className="w-2.5 h-2.5 text-teal-700" />
              <span className="text-[8px] text-teal-700 font-medium">KPI</span>
            </div>
            <p className="text-[8px] text-ws-text-muted">Format: {node.kpi.requiredOutputFormat}</p>
            <div className="space-y-0.5 mt-0.5">
              {node.kpi.successCriteria.map((c, i) => (
                <div key={i} className="flex items-start gap-1">
                  <CheckCircle2 className="w-2 h-2 text-teal-700 mt-0.5 shrink-0" />
                  <span className="text-[8px] text-ws-text-muted">{c}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Auditors */}
          <div className="bg-ws-subtle rounded px-2 py-1.5">
            <div className="flex items-center gap-1 mb-0.5">
              <Shield className="w-2.5 h-2.5 text-red-700" />
              <span className="text-[8px] text-red-700 font-medium">Auditors</span>
            </div>
            {node.auditors.map((auditor) => (
              <div key={auditor.auditorType} className="mb-1">
                <p className="text-[8px] text-ws-text-soft font-medium">{auditor.auditorType}</p>
                {auditor.checkRules.map((rule, i) => (
                  <div key={i} className="flex items-start gap-1 ml-2">
                    <div className={cn(
                      "w-1 h-1 rounded-full mt-1 shrink-0",
                      rule.severity === "critical" ? "bg-red-400" : rule.severity === "warning" ? "bg-amber-400" : "bg-blue-400"
                    )} />
                    <span className="text-[7px] text-ws-text-muted">{rule.checkDescription}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Cost */}
          {node.schedule.estimatedCost > 0 && (
            <div className="flex items-center gap-1 text-[8px] text-muted-foreground">
              <DollarSign className="w-2.5 h-2.5" />
              <span>Estimated cost: ${node.schedule.estimatedCost.toFixed(2)}</span>
            </div>
          )}

          {/* Configure button */}
          {onConfigure && (
            <Button
              size="sm"
              className="w-full h-6 text-[8px] bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-100"
              onClick={(e) => { e.stopPropagation(); onConfigure(node); }}
            >
              <Sliders className="w-2 h-2 mr-1" />
              Configure Node (Model, KPI, Auditors)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Modal ───────────────────────────────────────────────────────────────

export default function WorkflowSetupModal() {
  const { showWorkflowSetup, setShowWorkflowSetup } = useWorkforceStore();

  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [generating, setGenerating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<GeneratedWorkflow | null>(null);
  const [executionResult, setExecutionResult] = useState<string | null>(null);
  const [configNode, setConfigNode] = useState<TaskNode | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setWorkflow(null);
    setExecutionResult(null);

    try {
      const result = await generateWorkflow(prompt.trim(), context.trim());
      setWorkflow(result);
    } catch (err) {
      // Fallback to mock if API fails
      console.warn("[Lyceum] Workflow generation API failed, using mock:", err);
      const mock = generateMockWorkflow(prompt.trim(), context.trim());
      setWorkflow(mock);
      setError("Using demo mode (AI generation unavailable, showing sample workflow)");
    } finally {
      setGenerating(false);
    }
  };

  const handleExecute = async () => {
    if (!workflow) return;
    setExecuting(true);
    setError(null);

    try {
      const result = await executeWorkflow(workflow);
      setExecutionResult(
        `Workflow ${result.status}! Nodes: ${Object.values(result.nodeStates).filter((n) => n.status === "passed").length} passed, ${Object.values(result.nodeStates).filter((n) => n.status === "failed").length} failed, ${Object.values(result.nodeStates).filter((n) => n.status === "awaiting_human").length} awaiting human. Total cost: $${result.totalCost.toFixed(2)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  };

  const handleClose = () => {
    setShowWorkflowSetup(false);
    setWorkflow(null);
    setError(null);
    setExecutionResult(null);
    setPrompt("");
    setContext("");
  };

  if (!showWorkflowSetup) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/25 backdrop-blur-sm">
      <div className="w-[560px] max-h-[80vh] bg-ws-bg border border-ws-border rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-ws-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-teal-100 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-teal-700" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-ws-text">AI Workflow Generator</h3>
              <p className="text-[9px] text-muted-foreground">Powered by KIMI 3 — Organizer AI</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-ws-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {!workflow ? (
              /* ── Setup Form ── */
              <>
                <div>
                  <label className="text-[10px] text-ws-text-soft font-medium mb-1 block">Task Description</label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe what you want to accomplish (e.g., 'Create a marketing campaign for our new product launch including email sequences, social media posts, and landing page copy')"
                    className="h-20 text-[11px] bg-ws-subtle border-ws-border text-ws-text resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-ws-text-soft font-medium mb-1 block">Context (optional)</label>
                  <Textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Provide additional context: target audience, brand guidelines, budget constraints, deadlines, etc."
                    className="h-16 text-[11px] bg-ws-subtle border-ws-border text-ws-text resize-none"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-1.5 text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  className="w-full h-8 text-[10px] bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || generating}
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      Generating Workflow...
                    </>
                  ) : (
                    <>
                      <Brain className="w-3 h-3 mr-1.5" />
                      Generate Optimized Workflow
                    </>
                  )}
                </Button>
              </>
            ) : (
              /* ── Workflow Display ── */
              <>
                {/* Summary */}
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[11px] font-medium text-ws-text">{workflow.name}</h4>
                    <Badge variant="outline" className="text-[8px] text-teal-700 border-teal-200">
                      {workflow.nodes.length} steps
                    </Badge>
                  </div>
                  <p className="text-[9px] text-ws-text-muted leading-relaxed mb-2">{workflow.description}</p>
                  <div className="flex items-center gap-3 text-[8px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" /> ~{workflow.totalEstimatedMinutes}m
                    </span>
                    <span className="flex items-center gap-0.5">
                      <DollarSign className="w-2.5 h-2.5" /> ${workflow.totalEstimatedCost.toFixed(2)}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Bot className="w-2.5 h-2.5" /> {workflow.nodes.filter((n) => n.allocation.assigneeType === "AI").length} AI
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" /> {workflow.nodes.filter((n) => n.allocation.assigneeType === "HUMAN").length} Human
                    </span>
                  </div>
                </div>

                {/* Schedule Strategy */}
                {workflow.scheduleStrategy && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5">
                    <p className="text-[8px] text-indigo-700 uppercase tracking-wider mb-0.5">Schedule Strategy</p>
                    <p className="text-[9px] text-ws-text-muted">{workflow.scheduleStrategy}</p>
                  </div>
                )}

                {/* KPI Summary */}
                {workflow.kpiSummary && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                    <p className="text-[8px] text-green-700 uppercase tracking-wider mb-0.5">KPI Summary</p>
                    <p className="text-[9px] text-ws-text-muted">{workflow.kpiSummary}</p>
                  </div>
                )}

                {/* Node Cards */}
                <div className="space-y-1.5">
                  <p className="text-[8px] text-muted-foreground uppercase tracking-wider">Workflow Steps ({workflow.nodes.length})</p>
                  {workflow.nodes
                    .sort((a, b) => a.order - b.order)
                    .map((node, i) => (
                      <TaskNodeCard key={node.id} node={node} index={i} onConfigure={setConfigNode} />
                    ))}
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-start gap-1.5 text-[9px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Execution Result */}
                {executionResult && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                    <p className="text-[8px] text-green-700 uppercase tracking-wider mb-0.5">Execution Result</p>
                    <p className="text-[9px] text-ws-text-soft">{executionResult}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-7 text-[9px] bg-teal-100 text-teal-700 border border-teal-200 hover:bg-teal-100"
                    onClick={handleExecute}
                    disabled={executing}
                  >
                    {executing ? (
                      <><Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" /> Executing...</>
                    ) : (
                      <><Play className="w-2.5 h-2.5 mr-1" /> Execute Workflow</>
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-7 text-[9px] text-muted-foreground hover:text-ws-text"
                    onClick={() => { setWorkflow(null); setError(null); setExecutionResult(null); }}
                  >
                    Back
                  </Button>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Task Config Panel overlay */}
      {configNode && (
        <TaskConfigPanel
          node={configNode}
          onSave={(updated) => {
            if (!workflow) return;
            setWorkflow({
              ...workflow,
              nodes: workflow.nodes.map((n) =>
                n.id === updated.id ? updated : n
              ),
            });
            setConfigNode(null);
          }}
          onClose={() => setConfigNode(null)}
        />
      )}
    </div>
  );
}
