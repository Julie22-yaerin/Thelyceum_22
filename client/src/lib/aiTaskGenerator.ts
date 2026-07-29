/**
 * AI Task Generator & Optimizer — The Lyceum
 *
 * Takes a user's short task description and expands it into a detailed,
 * optimized workflow using the "Organizer AI" (KIMI 3 via OpenRouter).
 *
 * Schema:
 *   TaskNode       → Individual step in the workflow
 *   RoleAllocation → HUMAN or AI assignee
 *   ExecutionSchedule → Time blocks for cost optimization
 *   KPIConfig      → Quality thresholds, formats, success criteria
 *   AuditAssignment → Which auditors check what
 */

import type { Domain } from "@/lib/modelConfig";

// ── 1. Data Schema ───────────────────────────────────────────────────────────

export type AssigneeType = "HUMAN" | "AI";

export interface RoleAllocation {
  assigneeType: AssigneeType;
  /** If AI, which model slug to use by default */
  defaultModel?: string;
  /** Whether a human can override the model before execution */
  allowHumanOverride: boolean;
  /** Which domain the AI agent belongs to */
  domain?: Domain;
  /** Human role name if applicable */
  humanRoleName?: string;
}

export interface ExecutionSchedule {
  /** Suggested time blocks (e.g. ["00:00-06:00", "14:00-16:00"]) */
  suggestedBlocks: string[];
  /** Whether this task can be batched with others */
  batchingAllowed: boolean;
  /** Reason for the schedule recommendation */
  rationale: string;
  /** Estimated token cost for this node */
  estimatedCost: number;
}

export interface KPIConfig {
  /** 0-100 quality threshold */
  minimumQualityThreshold: number;
  /** Expected output format (e.g. "json", "markdown", "code", "text") */
  requiredOutputFormat: string;
  /** Specific success criteria (bullet points) */
  successCriteria: string[];
  /** How to measure success */
  measurementMethod: string;
}

export interface AuditCheckRule {
  /** What the auditor is checking */
  checkDescription: string;
  /** Severity if check fails */
  severity: "critical" | "warning" | "info";
  /** Specific instruction for the auditor AI */
  instruction: string;
}

export interface AuditAssignment {
  /** Which auditor type */
  auditorType: "Technical" | "Cost" | "Legal" | "Quality" | "Custom";
  /** Custom auditor name if type is Custom */
  customAuditorName?: string;
  /** Specific rules for this auditor on this node */
  checkRules: AuditCheckRule[];
}

export interface TaskNode {
  id: string;
  /** Step title */
  title: string;
  /** Detailed description of what this step does */
  description: string;
  /** Order in the workflow (1-based) */
  order: number;
  /** Who does this step */
  allocation: RoleAllocation;
  /** When to execute */
  schedule: ExecutionSchedule;
  /** Quality & success criteria */
  kpi: KPIConfig;
  /** Which auditors monitor this node */
  auditors: AuditAssignment[];
  /** Dependencies (IDs of TaskNodes that must complete first) */
  dependsOn: string[];
  /** Estimated duration in minutes */
  estimatedDurationMinutes: number;
}

export interface GeneratedWorkflow {
  id: string;
  /** Original user prompt */
  originalPrompt: string;
  /** Marketing context provided by user */
  context: string;
  /** High-level workflow name */
  name: string;
  /** Overall description */
  description: string;
  /** All task nodes in the workflow */
  nodes: TaskNode[];
  /** Total estimated cost in USD */
  totalEstimatedCost: number;
  /** Total estimated duration */
  totalEstimatedMinutes: number;
  /** Recommended overall schedule strategy */
  scheduleStrategy: string;
  /** KPI summary */
  kpiSummary: string;
  /** When this was generated */
  createdAt: number;
  /** Whether the workflow has been executed */
  executed: boolean;
}

// ── 2. LLM System Prompt (The "Organizer AI" Brain) ──────────────────────────

export const ORGANIZER_SYSTEM_PROMPT = `You are the Organizer AI — an expert workflow architect for "The Lyceum" platform. Your job is to take a user's short task description and expand it into a detailed, highly optimized workflow.

You MUST output ONLY valid JSON. No markdown, no code fences, no explanations.

The JSON schema you must follow:

{
  "name": "Short workflow name",
  "description": "1-2 sentence description of the overall workflow",
  "nodes": [
    {
      "title": "Step title",
      "description": "Detailed description of this step",
      "order": 1,
      "allocation": {
        "assigneeType": "HUMAN" | "AI",
        "defaultModel": "If AI: claude-3.5-sonnet, gpt-4o, gemini-2.5-flash, etc. If HUMAN: null",
        "allowHumanOverride": true,
        "domain": "If AI: LAW, FINANCE, or TECH. If HUMAN: null",
        "humanRoleName": "If HUMAN: the role name (e.g. 'Marketing Lead'). If AI: null"
      },
      "schedule": {
        "suggestedBlocks": ["Recommended time blocks like '00:00-06:00' for batch AI"],
        "batchingAllowed": true,
        "rationale": "Why this schedule is optimal",
        "estimatedCost": 0.0
      },
      "kpi": {
        "minimumQualityThreshold": 85,
        "requiredOutputFormat": "json",
        "successCriteria": ["Criterion 1", "Criterion 2"],
        "measurementMethod": "How to measure success"
      },
      "auditors": [
        {
          "auditorType": "Technical" | "Cost" | "Legal" | "Quality" | "Custom",
          "customAuditorName": "If Custom, the name",
          "checkRules": [
            {
              "checkDescription": "What to check",
              "severity": "critical" | "warning" | "info",
              "instruction": "Specific instruction for the auditor AI"
            }
          ]
        }
      ],
      "dependsOn": [],
      "estimatedDurationMinutes": 30
    }
  ],
  "totalEstimatedCost": 0.0,
  "totalEstimatedMinutes": 0,
  "scheduleStrategy": "Overall schedule strategy description",
  "kpiSummary": "Summary of KPIs across all nodes"
}

RULES:
1. Break the workflow into granular, actionable steps (5-12 nodes typically).
2. Intelligently decide HUMAN vs AI: HUMAN for creative strategy, nuanced decisions, approvals. AI for data processing, generation, analysis, automation.
3. Recommend the most cost-effective model: use cheaper models (gemini-2.5-flash, claude-3.5-haiku) for simple tasks, premium models (claude-3.5-sonnet, gpt-4o) for complex reasoning.
4. Batch non-urgent AI tasks for off-peak hours (00:00-06:00) to optimize costs.
5. Generate strict, step-specific auditor instructions — each auditor must check something concrete.
6. Set realistic quality thresholds (70-95) based on task criticality.
7. Minimum 4 nodes, maximum 15 nodes.
8. Total estimated cost should be reasonable (typically $0.50-$20.00).
9. Each node should have at least 1 auditor with at least 2 check rules.`;

// ── 3. AI Generation Function ────────────────────────────────────────────────

export async function generateWorkflow(
  prompt: string,
  context: string,
): Promise<GeneratedWorkflow> {
  const workflowId = `workflow-${Date.now()}`;

  const userMessage = `Generate an optimized workflow for:

Task: ${prompt}
Context: ${context}

Output the workflow JSON following the schema exactly.`;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "KIMI",
        messages: [
          { role: "system", content: ORGANIZER_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        maxTokens: 8192,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "unknown");
      throw new Error(`Workflow generation failed: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let parsed: Partial<GeneratedWorkflow>;
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = JSON.parse(rawText);
    }

    const nodes: TaskNode[] = (parsed.nodes || []).map((node: any, i: number) => ({
      ...node,
      id: `tasknode-${workflowId}-${i + 1}`,
      dependsOn: node.dependsOn || [],
    }));

    return {
      id: workflowId,
      originalPrompt: prompt,
      context,
      name: parsed.name || "Generated Workflow",
      description: parsed.description || "",
      nodes,
      totalEstimatedCost: parsed.totalEstimatedCost || 0,
      totalEstimatedMinutes: parsed.totalEstimatedMinutes || 0,
      scheduleStrategy: parsed.scheduleStrategy || "",
      kpiSummary: parsed.kpiSummary || "",
      createdAt: Date.now(),
      executed: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Workflow generation failed: ${message}`);
  }
}

// ── 4. Mock Workflow (for demo/preview) ──────────────────────────────────────

export function generateMockWorkflow(prompt: string, context: string): GeneratedWorkflow {
  const workflowId = `workflow-${Date.now()}`;

  return {
    id: workflowId,
    originalPrompt: prompt,
    context,
    name: `${prompt.slice(0, 40)} — Optimized Pipeline`,
    description: `AI-optimized workflow for "${prompt}" with intelligent HUMAN/AI allocation, cost-aware scheduling, and multi-layer audit checks.`,
    nodes: [
      {
        id: `${workflowId}-n1`,
        title: "Strategy & Requirements",
        description: "Define the overall strategy, success criteria, and resource allocation for this task.",
        order: 1,
        allocation: {
          assigneeType: "HUMAN",
          allowHumanOverride: false,
          humanRoleName: context ? `${context} Lead` : "Project Lead",
        },
        schedule: {
          suggestedBlocks: ["09:00-11:00"],
          batchingAllowed: false,
          rationale: "Requires human strategic thinking during business hours",
          estimatedCost: 0,
        },
        kpi: {
          minimumQualityThreshold: 90,
          requiredOutputFormat: "document",
          successCriteria: [
            "Clear, measurable success metrics defined",
            "Resource allocation plan documented",
            "Risk assessment completed",
          ],
          measurementMethod: "Manual review by project lead",
        },
        auditors: [
          {
            auditorType: "Quality",
            checkRules: [
              { checkDescription: "Verify all success criteria are measurable", severity: "critical", instruction: "Check each criterion has a quantifiable metric" },
              { checkDescription: "Ensure resource allocation is realistic", severity: "warning", instruction: "Cross-reference with available team capacity" },
            ],
          },
        ],
        dependsOn: [],
        estimatedDurationMinutes: 60,
      },
      {
        id: `${workflowId}-n2`,
        title: "Research & Data Collection",
        description: "AI-driven research to gather relevant data, market insights, and reference materials.",
        order: 2,
        allocation: {
          assigneeType: "AI",
          defaultModel: "google/gemini-2.5-flash",
          allowHumanOverride: true,
          domain: "TECH",
        },
        schedule: {
          suggestedBlocks: ["00:00-06:00"],
          batchingAllowed: true,
          rationale: "Batch AI research during off-peak hours for cost optimization",
          estimatedCost: 0.35,
        },
        kpi: {
          minimumQualityThreshold: 80,
          requiredOutputFormat: "structured_data",
          successCriteria: [
            "Minimum 10 relevant sources identified",
            "Data organized in structured format",
            "Sources properly cited",
          ],
          measurementMethod: "AI auditor validates source count and structure",
        },
        auditors: [
          {
            auditorType: "Technical",
            checkRules: [
              { checkDescription: "Validate data structure completeness", severity: "critical", instruction: "Ensure all required fields are populated" },
              { checkDescription: "Check source diversity", severity: "warning", instruction: "Verify sources span multiple categories and perspectives" },
            ],
          },
          {
            auditorType: "Cost",
            checkRules: [
              { checkDescription: "Verify token usage within budget", severity: "critical", instruction: "Check actual cost vs estimated cost, flag if over 120%" },
            ],
          },
        ],
        dependsOn: [`${workflowId}-n1`],
        estimatedDurationMinutes: 45,
      },
      {
        id: `${workflowId}-n3`,
        title: "Content Generation",
        description: "AI generates the primary deliverables based on research and strategy.",
        order: 3,
        allocation: {
          assigneeType: "AI",
          defaultModel: "anthropic/claude-sonnet-5",
          allowHumanOverride: true,
          domain: "LAW",
        },
        schedule: {
          suggestedBlocks: ["06:00-08:00", "20:00-22:00"],
          batchingAllowed: false,
          rationale: "Premium model needed for high-quality output; schedule during low-traffic windows",
          estimatedCost: 2.50,
        },
        kpi: {
          minimumQualityThreshold: 88,
          requiredOutputFormat: "markdown",
          successCriteria: [
            "All key points from research incorporated",
            "Output matches brand voice guidelines",
            "Factual claims have citations",
          ],
          measurementMethod: "Automated quality score + Legal auditor review",
        },
        auditors: [
          {
            auditorType: "Legal",
            checkRules: [
              { checkDescription: "Check for factual accuracy and citations", severity: "critical", instruction: "Verify all claims have supporting citations from research" },
              { checkDescription: "Flag any potential legal risks", severity: "critical", instruction: "Review for defamatory content, trademark issues, or compliance violations" },
            ],
          },
          {
            auditorType: "Technical",
            checkRules: [
              { checkDescription: "Validate output format", severity: "warning", instruction: "Ensure output is valid markdown with proper structure" },
              { checkDescription: "Check content length within limits", severity: "info", instruction: "Verify content does not exceed maximum length requirements" },
            ],
          },
        ],
        dependsOn: [`${workflowId}-n2`],
        estimatedDurationMinutes: 90,
      },
      {
        id: `${workflowId}-n4`,
        title: "Human Review & Refinement",
        description: "Human expert reviews the AI-generated content, provides feedback, and requests refinements.",
        order: 4,
        allocation: {
          assigneeType: "HUMAN",
          allowHumanOverride: false,
          humanRoleName: context ? `${context} Manager` : "Content Manager",
        },
        schedule: {
          suggestedBlocks: ["10:00-12:00", "14:00-16:00"],
          batchingAllowed: false,
          rationale: "Human review requires focused attention during peak productivity hours",
          estimatedCost: 0,
        },
        kpi: {
          minimumQualityThreshold: 95,
          requiredOutputFormat: "annotated_document",
          successCriteria: [
            "All AI-generated sections reviewed",
            "Feedback documented with specific suggestions",
            "Final approval given or changes requested",
          ],
          measurementMethod: "Manual sign-off after review",
        },
        auditors: [
          {
            auditorType: "Quality",
            checkRules: [
              { checkDescription: "Verify all sections were reviewed", severity: "critical", instruction: "Check each section has a review comment or approval" },
              { checkDescription: "Feedback quality check", severity: "warning", instruction: "Ensure feedback is specific and actionable" },
            ],
          },
        ],
        dependsOn: [`${workflowId}-n3`],
        estimatedDurationMinutes: 120,
      },
      {
        id: `${workflowId}-n5`,
        title: "QA & Technical Audit",
        description: "Final automated QA pass with technical, cost, and legal auditors verifying the complete output.",
        order: 5,
        allocation: {
          assigneeType: "AI",
          defaultModel: "openai/gpt-4o",
          allowHumanOverride: true,
          domain: "FINANCE",
        },
        schedule: {
          suggestedBlocks: ["00:00-06:00"],
          batchingAllowed: true,
          rationale: "Batch final audit with other end-of-day tasks for cost efficiency",
          estimatedCost: 0.80,
        },
        kpi: {
          minimumQualityThreshold: 92,
          requiredOutputFormat: "audit_report",
          successCriteria: [
            "All auditor checks pass at 'warning' level or above",
            "No critical failures",
            "Audit report generated and saved",
          ],
          measurementMethod: "Automated auditor aggregation + final score",
        },
        auditors: [
          {
            auditorType: "Technical",
            checkRules: [
              { checkDescription: "Validate final output against all technical requirements", severity: "critical", instruction: "Run comprehensive technical validation suite" },
              { checkDescription: "Check for any PII or sensitive data leaks", severity: "critical", instruction: "Scan entire output for PII patterns, API keys, tokens" },
            ],
          },
          {
            auditorType: "Cost",
            checkRules: [
              { checkDescription: "Calculate total cost vs budget", severity: "critical", instruction: "Sum all node costs and compare to allocated budget" },
              { checkDescription: "Flag cost optimization opportunities", severity: "info", instruction: "Identify nodes where a cheaper model could be used next time" },
            ],
          },
          {
            auditorType: "Legal",
            checkRules: [
              { checkDescription: "Final compliance check", severity: "critical", instruction: "Verify output complies with all relevant regulations" },
            ],
          },
        ],
        dependsOn: [`${workflowId}-n4`],
        estimatedDurationMinutes: 30,
      },
    ],
    totalEstimatedCost: 3.65,
    totalEstimatedMinutes: 345,
    scheduleStrategy: "Batch AI research and audit during off-peak (00:00-06:00). Premium content generation scheduled in early morning. Human review during business hours. Total estimated wall-clock time: ~6 hours.",
    kpiSummary: "Quality thresholds range from 80% (research) to 95% (human review). Three auditor types (Technical, Legal, Cost) provide multi-layer validation. Success criteria are concrete and measurable across all nodes.",
    createdAt: Date.now(),
    executed: false,
  };
}

// ── 5. Execution Logic Outline ───────────────────────────────────────────────

export interface ExecutionState {
  workflowId: string;
  nodeStates: Record<string, NodeExecutionState>;
  startedAt: number;
  completedAt?: number;
  totalCost: number;
  status: "pending" | "running" | "paused" | "completed" | "failed";
}

export interface NodeExecutionState {
  nodeId: string;
  status: "pending" | "ready" | "running" | "awaiting_human" | "auditing" | "passed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  cost?: number;
  output?: string;
  auditResults?: AuditResult[];
  error?: string;
}

export interface AuditResult {
  auditorType: string;
  passed: boolean;
  score: number;
  checks: { description: string; passed: boolean; message: string }[];
}

/**
 * Execute a workflow — respects scheduling, halts on audit failure,
 * waits for human input on HUMAN-assigned nodes.
 */
export async function executeWorkflow(workflow: GeneratedWorkflow): Promise<ExecutionState> {
  const state: ExecutionState = {
    workflowId: workflow.id,
    nodeStates: {},
    startedAt: Date.now(),
    totalCost: 0,
    status: "running",
  };

  // Initialize all nodes
  workflow.nodes.forEach((node) => {
    state.nodeStates[node.id] = {
      nodeId: node.id,
      status: node.dependsOn.length === 0 ? "ready" : "pending",
    };
  });

  const executeNode = async (node: TaskNode): Promise<void> => {
    const nodeState = state.nodeStates[node.id];

    // Check schedule compliance
    const now = new Date();
    const hour = now.getHours();
    const inSchedule = node.schedule.suggestedBlocks.some((block) => {
      const [start, end] = block.split("-").map(Number);
      if (end > start) return hour >= start && hour < end;
      return hour >= start || hour < end; // overnight block
    });

    if (!inSchedule && node.allocation.assigneeType === "AI") {
      // Queue for scheduled execution — in production this would go to a scheduler
      console.log(`[Lyceum] ${node.title} queued for schedule: ${node.schedule.suggestedBlocks.join(", ")}`);
    }

    nodeState.status = "running";
    nodeState.startedAt = Date.now();

    if (node.allocation.assigneeType === "HUMAN") {
      // HUMAN task — pause and wait for input
      nodeState.status = "awaiting_human";
      // In production, this would trigger a notification and wait for callback
      console.log(`[Lyceum] Awaiting human input for: ${node.title}`);
      return;
    }

    // AI task — execute with audit
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: node.allocation.domain || "TECH",
          messages: [
            { role: "system", content: `You are executing step "${node.title}" in a workflow. Description: ${node.description}. Output must be in ${node.kpi.requiredOutputFormat} format.` },
            { role: "user", content: `Execute this step. Success criteria:\n${node.kpi.successCriteria.map((c) => `- ${c}`).join("\n")}` },
          ],
          temperature: 0.3,
          maxTokens: 4096,
        }),
      });

      if (!response.ok) {
        throw new Error(`Execution failed: ${response.status}`);
      }

      const data = await response.json();
      nodeState.output = data.choices?.[0]?.message?.content || "";
      nodeState.cost = data.usage?.total_cost || 0;
      state.totalCost += nodeState.cost!;

      // Run AI auditors
      nodeState.status = "auditing";
      const auditResults: AuditResult[] = [];

      for (const auditor of node.auditors) {
        const auditPrompt = `Audit this output for "${auditor.auditorType}" compliance. Rules:\n${auditor.checkRules.map((r) => `- [${r.severity}] ${r.checkDescription}: ${r.instruction}`).join("\n")}\n\nOutput to audit:\n${nodeState.output}`;

        const auditResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: "TECH",
            messages: [
              { role: "system", content: "You are an AI auditor. Evaluate the output against the check rules. Return JSON: { passed: boolean, score: number (0-100), checks: [{ description: string, passed: boolean, message: string }] }" },
              { role: "user", content: auditPrompt },
            ],
            temperature: 0.1,
            maxTokens: 2048,
          }),
        });

        if (auditResponse.ok) {
          const auditData = await auditResponse.json();
          const auditText = auditData.choices?.[0]?.message?.content || "{}";
          const auditJson = JSON.parse(auditText.match(/\{[\s\S]*\}/)?.[0] || "{}");
          auditResults.push({
            auditorType: auditor.auditorType,
            passed: auditJson.passed ?? true,
            score: auditJson.score ?? 100,
            checks: auditJson.checks || [],
          });
        }
      }

      nodeState.auditResults = auditResults;

      // Check if all critical auditors passed
      const criticalFailures = auditResults.filter((r) => !r.passed).length > 0;
      const allPassed = auditResults.every((r) => r.passed);

      if (allPassed) {
        nodeState.status = "passed";
      } else if (criticalFailures) {
        nodeState.status = "failed";
        nodeState.error = `Failed ${criticalFailures} auditor(s)`;
      } else {
        // Warning-level failures — mark as passed with note
        nodeState.status = "passed";
      }
    } catch (err) {
      nodeState.status = "failed";
      nodeState.error = err instanceof Error ? err.message : String(err);
    }

    nodeState.completedAt = Date.now();
  };

  // Execute in dependency order
  const executeInOrder = async (nodes: TaskNode[]): Promise<void> => {
    const executed = new Set<string>();

    while (executed.size < nodes.length) {
      const ready = nodes.filter(
        (n) =>
          !executed.has(n.id) &&
          n.dependsOn.every((d) => executed.has(d))
      );

      if (ready.length === 0) break; // Circular dependency or all done

      await Promise.all(
        ready.map(async (node) => {
          await executeNode(node);
          executed.add(node.id);
        })
      );
    }
  };

  await executeInOrder(workflow.nodes);

  // Check overall status
  const nodeStates = Object.values(state.nodeStates);
  const failures = nodeStates.filter((n) => n.status === "failed").length;

  state.status = failures > 0 ? "failed" : "completed";
  state.completedAt = Date.now();

  return state;
}
