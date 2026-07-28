import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  User,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Coins,
  ArrowRight,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

/*
 * The Lyceum — AI Workflow Simulation
 * Blueprint Minimal style: warm white, charcoal, teal accent
 * Interactive step-by-step workflow showing AI-human collaboration,
 * credit management, and network topology.
 */

const fadeInUp = {
  initial: { y: 20, opacity: 0 },
  whileInView: { y: 0, opacity: 1 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] as const },
};

interface WorkflowStep {
  id: number;
  actor: "human" | "ai";
  name: string;
  action: string;
  detail: string;
  creditCost?: number;
  status: "pending" | "active" | "done";
}

const initialSteps: WorkflowStep[] = [
  {
    id: 1,
    actor: "human",
    name: "Sarah (Product Lead)",
    action: "Submit task: Draft Q3 market analysis",
    detail: "Sarah assigns a cross-functional research task to the AI team.",
    status: "pending",
  },
  {
    id: 2,
    actor: "ai",
    name: "Research Agent",
    action: "Gathers market data from 12 sources",
    detail: "Agent scans competitor filings, industry reports, and sentiment data.",
    creditCost: 45,
    status: "pending",
  },
  {
    id: 3,
    actor: "ai",
    name: "Analysis Agent",
    action: "Cross-references findings with Research Agent",
    detail: "Agents communicate internally to validate data consistency.",
    creditCost: 32,
    status: "pending",
  },
  {
    id: 4,
    actor: "ai",
    name: "Audit Agent",
    action: "Flags potential hallucination in revenue forecast",
    detail: "Audit layer detects a 2.4x anomaly — request sent back for correction.",
    creditCost: 18,
    status: "pending",
  },
  {
    id: 5,
    actor: "ai",
    name: "Analysis Agent",
    action: "Corrects forecast, re-submits for approval",
    detail: "Data recalculated using verified internal benchmarks.",
    creditCost: 22,
    status: "pending",
  },
  {
    id: 6,
    actor: "human",
    name: "Sarah (Product Lead)",
    action: "Reviews and approves final output",
    detail: "Sarah signs off. Decision chain fully auditable and logged.",
    status: "pending",
  },
];

const networkNodes = [
  { id: "sarah", type: "human", label: "Sarah", role: "Product Lead", x: 50, y: 15 },
  { id: "research", type: "ai", label: "Research Agent", role: "Data Collection", x: 20, y: 45 },
  { id: "analysis", type: "ai", label: "Analysis Agent", role: "Synthesis & Modeling", x: 50, y: 45 },
  { id: "audit", type: "ai", label: "Audit Agent", role: "Quality & Compliance", x: 80, y: 45 },
  { id: "mike", type: "human", label: "Mike", role: "Engineering Lead", x: 25, y: 78 },
  { id: "writer", type: "ai", label: "Writer Agent", role: "Report Drafting", x: 55, y: 78 },
  { id: "lisa", type: "human", label: "Lisa", role: "Operations", x: 82, y: 78 },
];

const networkConnections = [
  { from: "sarah", to: "research" },
  { from: "sarah", to: "analysis" },
  { from: "sarah", to: "audit" },
  { from: "research", to: "analysis" },
  { from: "analysis", to: "audit" },
  { from: "audit", to: "sarah" },
  { from: "mike", to: "analysis" },
  { from: "mike", to: "writer" },
  { from: "writer", to: "sarah" },
  { from: "lisa", to: "writer" },
  { from: "lisa", to: "audit" },
];

export default function AIWorkflowSimulation() {
  const [steps, setSteps] = useState<WorkflowStep[]>(initialSteps);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalCreditsUsed, setTotalCreditsUsed] = useState(0);
  const [creditBudget] = useState(500);
  const [activeNodes, setActiveNodes] = useState<Set<string>>(new Set());

  const reset = useCallback(() => {
    setSteps(initialSteps.map((s) => ({ ...s, status: "pending" as const })));
    setCurrentStep(-1);
    setIsPlaying(false);
    setTotalCreditsUsed(0);
    setActiveNodes(new Set());
  }, []);

  const executeNext = useCallback(() => {
    setCurrentStep((prev) => {
      const next = prev + 1;
      if (next >= steps.length) {
        setIsPlaying(false);
        return prev;
      }
      setSteps((prevSteps) =>
        prevSteps.map((s, i) => ({
          ...s,
          status: i < next ? "done" : i === next ? "active" : "pending",
        }))
      );
      setTotalCreditsUsed((prev) => prev + (steps[next].creditCost || 0));
      setActiveNodes((prev) => new Set(prev).add(steps[next].actor === "human" ? (steps[next].id <= 2 ? "sarah" : steps[next].id >= 5 ? "sarah" : "sarah") : steps[next].name.split(" ")[0].toLowerCase()));
      return next;
    });
  }, [steps]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setTimeout(() => {
      executeNext();
    }, 2000);
    return () => clearTimeout(timer);
  }, [isPlaying, currentStep, executeNext]);

  const startPlay = () => {
    if (currentStep >= steps.length - 1) reset();
    setIsPlaying(true);
  };

  const progressPercent = ((currentStep + 1) / steps.length) * 100;
  const remainingCredits = creditBudget - totalCreditsUsed;
  const creditPercent = (totalCreditsUsed / creditBudget) * 100;

  return (
    <section id="simulation" className="py-24 sm:py-32">
      <div className="container">
        {/* Section Header */}
        <motion.div {...fadeInUp} className="text-center max-w-2xl mx-auto mb-16">
          <p className="text-sm font-medium text-teal uppercase tracking-widest mb-4">
            See It In Action
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground leading-tight mb-4">
            Watch your AI team collaborate.
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            A real-time simulation of how AI agents and humans work together —
            communicating, auditing, and making decisions within credit boundaries.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Workflow Timeline */}
          <motion.div {...fadeInUp} className="lg:col-span-2">
            <div className="rounded-xl border border-border bg-white p-6 sm:p-8">
              {/* Controls */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <button
                    onClick={startPlay}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal hover:bg-teal-dark text-white text-sm font-medium transition-all active:scale-[0.97]"
                  >
                    <Play className="w-4 h-4" />
                    {currentStep >= steps.length - 1 ? "Replay" : "Play Simulation"}
                  </button>
                  <button
                    onClick={reset}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-secondary text-sm text-muted-foreground transition-all active:scale-[0.97]"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset
                  </button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Step {Math.max(currentStep + 1, 0)} / {steps.length}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1 bg-border rounded-full mb-8 overflow-hidden">
                <motion.div
                  className="h-full bg-teal rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>

              {/* Steps */}
              <div className="space-y-4">
                {steps.map((step, i) => (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{
                      opacity: step.status === "pending" ? 0.3 : 1,
                      x: 0,
                    }}
                    transition={{ duration: 0.3 }}
                    className={`flex items-start gap-4 p-4 rounded-lg transition-all ${
                      step.status === "active"
                        ? "bg-teal/5 border border-teal/20"
                        : step.status === "done"
                        ? "bg-secondary/50"
                        : ""
                    }`}
                  >
                    {/* Actor indicator */}
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        step.actor === "human"
                          ? "bg-charcoal text-white"
                          : "bg-teal/15 text-teal"
                      }`}
                    >
                      {step.actor === "human" ? (
                        <User className="w-4 h-4" />
                      ) : (
                        <Bot className="w-4 h-4" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground">
                          {step.name}
                        </span>
                        {step.creditCost && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-medium">
                            <Coins className="w-3 h-3" />
                            {step.creditCost}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground mb-1">{step.action}</p>
                      <p className="text-xs text-muted-foreground">{step.detail}</p>
                    </div>

                    {/* Status */}
                    <div className="shrink-0 mt-1">
                      {step.status === "done" && (
                        <CheckCircle2 className="w-5 h-5 text-teal" />
                      )}
                      {step.status === "active" && (
                        <div className="w-5 h-5 rounded-full border-2 border-teal border-t-transparent animate-spin" />
                      )}
                      {step.status === "pending" && (
                        <div className="w-5 h-5 rounded-full border-2 border-border" />
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Step 4 highlight - Audit flagged hallucination */}
              <AnimatePresence>
                {currentStep >= 3 && currentStep < 5 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mt-4 p-4 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-3"
                  >
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-amber-800">
                        Hallucination Detected
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        The Audit Agent flagged a 2.4x revenue anomaly. The system
                        automatically routed it back to the Analysis Agent for correction —
                        before it reached a human.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Final audit confirmation */}
              <AnimatePresence>
                {currentStep >= 5 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-4 rounded-lg bg-teal/5 border border-teal/20 flex items-start gap-3"
                  >
                    <ShieldCheck className="w-5 h-5 text-teal shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Decision Approved & Logged
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Full audit trail recorded. Every AI decision is traceable,
                        reviewable, and accountable.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Right: Credits + Network */}
          <div className="space-y-6">
            {/* Credit Management */}
            <motion.div {...fadeInUp}>
              <div className="rounded-xl border border-border bg-white p-6">
                <div className="flex items-center gap-2 mb-6">
                  <Coins className="w-5 h-5 text-teal" />
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Agent Credit Management
                  </h3>
                </div>

                <div className="space-y-5">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Credits Used</span>
                      <span className="font-display font-semibold text-foreground">
                        {totalCreditsUsed} / {creditBudget}
                      </span>
                    </div>
                    <div className="h-2 bg-border rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-teal"
                        initial={{ width: 0 }}
                        animate={{ width: `${creditPercent}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-secondary/50">
                      <p className="text-xs text-muted-foreground mb-1">Remaining</p>
                      <p className="font-display text-xl font-bold text-foreground">
                        {remainingCredits}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-secondary/50">
                      <p className="text-xs text-muted-foreground mb-1">Tasks</p>
                      <p className="font-display text-xl font-bold text-foreground">
                        {Math.max(currentStep + 1, 0)}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border space-y-2">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      Credit Breakdown
                    </p>
                    {steps
                      .filter((s) => s.creditCost && s.status === "done")
                      .map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate max-w-[140px]">
                            {s.name}
                          </span>
                          <span className="font-display font-medium text-foreground">
                            {s.creditCost}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Network Visualization */}
            <motion.div {...fadeInUp}>
              <div className="rounded-xl border border-border bg-white p-6">
                <h3 className="font-display text-base font-semibold text-foreground mb-1">
                  Human-AI Network
                </h3>
                <p className="text-xs text-muted-foreground mb-6">
                  3 humans · 4 AI agents · 11 connections
                </p>

                <div className="relative w-full aspect-square max-w-[280px] mx-auto">
                  <svg viewBox="0 0 100 100" className="w-full h-full">
                    {/* Connections */}
                    {networkConnections.map((conn, i) => {
                      const from = networkNodes.find((n) => n.id === conn.from)!;
                      const to = networkNodes.find((n) => n.id === conn.to)!;
                      const fromActive = activeNodes.has(from.id);
                      const toActive = activeNodes.has(to.id);
                      return (
                        <line
                          key={i}
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke={
                            fromActive && toActive
                              ? "#0d9488"
                              : fromActive || toActive
                              ? "#0d9488"
                              : "#e5e7eb"
                          }
                          strokeWidth={fromActive && toActive ? 0.6 : 0.3}
                          opacity={fromActive && toActive ? 1 : 0.6}
                          className="transition-all duration-500"
                        />
                      );
                    })}

                    {/* Nodes */}
                    {networkNodes.map((node) => {
                      const isActive = activeNodes.has(node.id);
                      return (
                        <g key={node.id}>
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={node.type === "human" ? 4 : 3}
                            fill={
                              node.type === "human"
                                ? isActive
                                  ? "#1a1a1a"
                                  : "#374151"
                                : isActive
                                ? "#0d9488"
                                : "#d4d4d4"
                            }
                            stroke={isActive ? "#0d9488" : "transparent"}
                            strokeWidth={isActive ? 1.5 : 0}
                            className="transition-all duration-500"
                          />
                          <text
                            x={node.x}
                            y={node.y + (node.type === "human" ? 8 : 7)}
                            textAnchor="middle"
                            fontSize="2.8"
                            fill={isActive ? "#1a1a1a" : "#9ca3af"}
                            fontWeight={isActive ? "600" : "400"}
                            className="font-sans transition-all duration-500"
                          >
                            {node.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-charcoal" />
                    <span className="text-xs text-muted-foreground">Human</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-teal" />
                    <span className="text-xs text-muted-foreground">AI Agent</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
