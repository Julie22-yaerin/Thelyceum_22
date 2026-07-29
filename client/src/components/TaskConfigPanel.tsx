/**
 * TaskConfigPanel — The Lyceum
 *
 * Human-in-the-loop configuration panel for AI-generated workflow nodes.
 * Allows users to:
 *   - Override the default AI model
 *   - Adjust minimum quality threshold (slider)
 *   - Edit KPI success criteria
 *   - Review and modify attached AI auditors and their check rules
 */

import { useState } from "react";
import {
  X,
  Sliders,
  Save,
  Bot,
  Shield,
  Target,
  Plus,
  Trash2,
  Check,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { TaskNode, AuditAssignment, AuditCheckRule } from "@/lib/aiTaskGenerator";
import { MODEL_ROUTES, type Domain } from "@/lib/modelConfig";

// ── Props ────────────────────────────────────────────────────────────────────

interface TaskConfigPanelProps {
  node: TaskNode;
  onSave: (updated: TaskNode) => void;
  onClose: () => void;
}

// ── Available Models ─────────────────────────────────────────────────────────

const AVAILABLE_MODELS = Object.entries(MODEL_ROUTES).map(([domain, route]) => ({
  id: route.model,
  label: route.provider,
  domain: domain as Domain,
}));

// ── Component ────────────────────────────────────────────────────────────────

export default function TaskConfigPanel({ node, onSave, onClose }: TaskConfigPanelProps) {
  const [qualityThreshold, setQualityThreshold] = useState(node.kpi.minimumQualityThreshold);
  const [selectedModel, setSelectedModel] = useState(node.allocation.defaultModel || "");
  const [successCriteria, setSuccessCriteria] = useState<string[]>(node.kpi.successCriteria);
  const [auditors, setAuditors] = useState<AuditAssignment[]>(node.auditors);
  const [newCriterion, setNewCriterion] = useState("");

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    setSuccessCriteria([...successCriteria, newCriterion.trim()]);
    setNewCriterion("");
  };

  const handleRemoveCriterion = (i: number) => {
    setSuccessCriteria(successCriteria.filter((_, idx) => idx !== i));
  };

  const handleAddAuditor = () => {
    setAuditors([
      ...auditors,
      {
        auditorType: "Custom",
        customAuditorName: "New Auditor",
        checkRules: [
          { checkDescription: "Describe what to check", severity: "warning", instruction: "Specific instruction for the auditor" },
        ],
      },
    ]);
  };

  const handleUpdateCheckRule = (
    auditorIdx: number,
    ruleIdx: number,
    field: keyof AuditCheckRule,
    value: string
  ) => {
    setAuditors(
      auditors.map((a, ai) =>
        ai === auditorIdx
          ? {
              ...a,
              checkRules: a.checkRules.map((r, ri) =>
                ri === ruleIdx ? { ...r, [field]: value } : r
              ),
            }
          : a
      )
    );
  };

  const handleAddCheckRule = (auditorIdx: number) => {
    setAuditors(
      auditors.map((a, ai) =>
        ai === auditorIdx
          ? {
              ...a,
              checkRules: [
                ...a.checkRules,
                { checkDescription: "New check", severity: "warning" as const, instruction: "Instruction" },
              ],
            }
          : a
      )
    );
  };

  const handleRemoveCheckRule = (auditorIdx: number, ruleIdx: number) => {
    setAuditors(
      auditors.map((a, ai) =>
        ai === auditorIdx
          ? { ...a, checkRules: a.checkRules.filter((_, ri) => ri !== ruleIdx) }
          : a
      )
    );
  };

  const handleSave = () => {
    const updated: TaskNode = {
      ...node,
      kpi: {
        ...node.kpi,
        minimumQualityThreshold: qualityThreshold,
        successCriteria,
      },
      allocation: {
        ...node.allocation,
        defaultModel: selectedModel || node.allocation.defaultModel,
      },
      auditors,
    };
    onSave(updated);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[480px] max-h-[85vh] bg-[#0f0f13] border border-white/10 rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-amber-500/15 flex items-center justify-center">
              <Sliders className="w-3 h-3 text-amber-400" />
            </div>
            <div>
              <h3 className="text-[11px] font-medium text-white/90">{node.title}</h3>
              <p className="text-[8px] text-muted-foreground">Node Configuration</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Model Selection */}
            {node.allocation.assigneeType === "AI" && (
              <div>
                <p className="text-[9px] text-white/70 font-medium mb-1.5 flex items-center gap-1">
                  <Bot className="w-3 h-3" /> AI Model
                </p>
                <div className="flex flex-wrap gap-1">
                  {AVAILABLE_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedModel(m.id)}
                      className={cn(
                        "px-2 py-1 rounded text-[9px] border transition-colors",
                        selectedModel === m.id
                          ? "bg-teal-500/15 text-teal-300 border-teal-500/30"
                          : "text-muted-foreground border-white/5 hover:text-white hover:border-white/10"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Separator className="bg-white/5" />

            {/* Quality Threshold */}
            <div>
              <p className="text-[9px] text-white/70 font-medium mb-1.5 flex items-center gap-1">
                <Target className="w-3 h-3" /> Quality Threshold
              </p>
              <div className="flex items-center gap-3">
                <Slider
                  value={[qualityThreshold]}
                  onValueChange={([v]) => setQualityThreshold(v)}
                  min={50}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className={cn(
                  "text-[10px] font-mono w-8 text-right",
                  qualityThreshold >= 90 ? "text-green-400" : qualityThreshold >= 80 ? "text-amber-400" : "text-muted-foreground"
                )}>
                  {qualityThreshold}%
                </span>
              </div>
              <p className="text-[7px] text-muted-foreground mt-0.5">
                {qualityThreshold >= 90 ? "Strict — high precision required" :
                 qualityThreshold >= 80 ? "Standard — balanced quality" :
                 "Relaxed — speed prioritized"}
              </p>
            </div>

            <Separator className="bg-white/5" />

            {/* Success Criteria */}
            <div>
              <p className="text-[9px] text-white/70 font-medium mb-1.5">Success Criteria</p>
              <div className="space-y-1">
                {successCriteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-1 group">
                    <Check className="w-2.5 h-2.5 text-teal-400 shrink-0" />
                    <span className="text-[9px] text-white/70 flex-1">{c}</span>
                    <button onClick={() => handleRemoveCriterion(i)}
                      className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1.5">
                <Input
                  value={newCriterion}
                  onChange={(e) => setNewCriterion(e.target.value)}
                  placeholder="Add criterion..."
                  className="h-6 text-[9px] bg-white/5 border-white/10 text-white flex-1"
                  onKeyDown={(e) => e.key === "Enter" && handleAddCriterion()}
                />
                <Button size="sm" className="h-6 text-[8px] px-2 bg-teal-500/20 text-teal-300 border border-teal-500/30"
                  onClick={handleAddCriterion} disabled={!newCriterion.trim()}>
                  <Plus className="w-2 h-2 mr-0.5" /> Add
                </Button>
              </div>
            </div>

            <Separator className="bg-white/5" />

            {/* Auditors */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] text-white/70 font-medium flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Auditors
                </p>
                <Button size="sm" variant="ghost" className="h-5 text-[8px] text-muted-foreground hover:text-white"
                  onClick={handleAddAuditor}>
                  <Plus className="w-2 h-2 mr-0.5" /> Add Auditor
                </Button>
              </div>

              <div className="space-y-2">
                {auditors.map((auditor, ai) => (
                  <div key={ai} className="bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <Badge variant="outline" className="text-[8px] h-4 px-1.5 text-red-400 border-red-500/20">
                        {auditor.auditorType}
                        {auditor.customAuditorName && `: ${auditor.customAuditorName}`}
                      </Badge>
                      <button onClick={() => setAuditors(auditors.filter((_, i) => i !== ai))}
                        className="text-muted-foreground hover:text-red-400">
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>

                    <div className="space-y-1">
                      {auditor.checkRules.map((rule, ri) => (
                        <div key={ri} className="flex items-start gap-1 group">
                          <div className={cn(
                            "w-1 h-1 rounded-full mt-1.5 shrink-0",
                            rule.severity === "critical" ? "bg-red-400" : rule.severity === "warning" ? "bg-amber-400" : "bg-blue-400"
                          )} />
                          <div className="flex-1 space-y-0.5">
                            <Input
                              value={rule.checkDescription}
                              onChange={(e) => handleUpdateCheckRule(ai, ri, "checkDescription", e.target.value)}
                              className="h-5 text-[8px] bg-white/5 border-white/10 text-white"
                            />
                            <Input
                              value={rule.instruction}
                              onChange={(e) => handleUpdateCheckRule(ai, ri, "instruction", e.target.value)}
                              className="h-5 text-[7px] bg-white/5 border-white/10 text-muted-foreground"
                            />
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <select
                              value={rule.severity}
                              onChange={(e) => handleUpdateCheckRule(ai, ri, "severity", e.target.value)}
                              className="h-5 text-[7px] bg-white/10 border-white/10 text-white rounded"
                            >
                              <option value="critical">Critical</option>
                              <option value="warning">Warning</option>
                              <option value="info">Info</option>
                            </select>
                            <button onClick={() => handleRemoveCheckRule(ai, ri)}
                              className="text-muted-foreground hover:text-red-400">
                              <X className="w-2 h-2" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Button size="sm" variant="ghost" className="h-4 text-[7px] text-muted-foreground hover:text-white mt-1"
                      onClick={() => handleAddCheckRule(ai)}>
                      <Plus className="w-2 h-2 mr-0.5" /> Add check rule
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5 flex gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-[9px] text-muted-foreground hover:text-white"
            onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-[9px] px-4 bg-teal-500/20 text-teal-300 border border-teal-500/30 hover:bg-teal-500/30 flex-1"
            onClick={handleSave}>
            <Save className="w-2.5 h-2.5 mr-1" /> Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
}
