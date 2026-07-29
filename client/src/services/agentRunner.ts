/**
 * Agent Runner — The Lyceum
 *
 * Runs AI agents assigned to tasks by calling the server-side streaming proxy.
 * Constructs per-role prompts using the human output as context.
 * Returns text deltas via an onChunk callback for real-time UI updates.
 */

import type { SelectedTask, TaskRoleAI } from "@/store/useSessionStore";
import { MODEL_ROUTES } from "@/lib/modelConfig";

// ── Per-role system prompts ─────────────────────────────────────────────────

const ROLE_SYSTEM_PROMPTS: Record<string, string> = {
  "Data Extraction Specialist":
    "You are a Data Extraction Specialist. Extract structured data, entities, relationships, and key metrics from the provided content. Output clean structured data in JSON format where applicable.",

  "Code Generation Specialist":
    "You are a Code Generation Specialist. Generate production-ready code based on the provided requirements. Include type definitions, error handling, and brief documentation. Output only the code and its explanation.",

  "Content Creator":
    "You are a Content Creator. Transform the provided material into polished, engaging content. Maintain brand voice, ensure clarity, and structure the output for readability.",

  "Legal Analyst":
    "You are a Legal Analyst at The Lyceum. Review the provided content for legal risks, compliance issues, and potential liabilities. Flag specific clauses, suggest mitigations, and cite relevant regulatory frameworks where applicable.",

  "Financial Analyst":
    "You are a Financial Analyst. Analyze the provided data for financial implications, cost structures, ROI projections, and budget recommendations. Present numbers in tables where helpful. Identify risks and opportunities.",

  "Quality Auditor":
    "You are a Quality Auditor. Review the output for correctness, completeness, and adherence to best practices. Check for logical errors, missing edge cases, and consistency issues. Provide a pass/fail assessment with specific findings.",

  "Research Assistant":
    "You are a Research Assistant. Synthesize the provided information into a well-structured research brief. Identify key themes, supporting evidence, counterpoints, and knowledge gaps. Cite sources where referenced.",

  "Executive Strategist":
    "You are an Executive Strategist. Analyze the provided context and provide strategic recommendations. Consider market positioning, resource allocation, competitive landscape, and risk. Frame recommendations as actionable next steps.",
};

function getSystemPrompt(roleName: string): string {
  return ROLE_SYSTEM_PROMPTS[roleName] ||
    `You are a ${roleName} at The Lyceum. Analyze the provided task context and produce a thorough, actionable output.`;
}

// ── Streaming API call ──────────────────────────────────────────────────────

export interface StreamChunk {
  /** The text delta received in this chunk */
  delta: string;
  /** The full accumulated text so far */
  accumulated: string;
  /** Whether the stream has finished */
  done: boolean;
}

export interface AgentRunConfig {
  /** The task being processed */
  task: SelectedTask;
  /** The specific AI role to run */
  role: TaskRoleAI;
  /** Callback for each text delta */
  onChunk: (chunk: StreamChunk) => void;
  /** Optional abort signal */
  signal?: AbortSignal;
}

/**
 * Run a single AI agent against OpenRouter via the server streaming proxy.
 * Calls onChunk for every text delta received from the stream.
 * Returns the final accumulated text.
 */
export async function runAgent(config: AgentRunConfig): Promise<string> {
  const { task, role, onChunk, signal } = config;

  const systemPrompt = getSystemPrompt(role.roleName);
  const domain = role.domain as keyof typeof MODEL_ROUTES;

  // Build messages: system prompt + context + human output
  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `## Task Context\n\n${task.description || "No description provided."}\n\n## Task Title\n\n${task.title}` },
  ];

  if (task.humanOutput) {
    messages.push({
      role: "user",
      content: `## Human Output (use this as the primary input for your analysis/processing)\n\n${task.humanOutput}`,
    });
  }

  messages.push({
    role: "user",
    content: `Please complete your work as ${role.roleName}. Provide a thorough, well-structured output.`,
  });

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, messages }),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Agent stream failed (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Response body is not readable");

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from the buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();

          if (data === "[DONE]") {
            // Stream complete
            break;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              accumulated += delta;
              onChunk({ delta, accumulated, done: false });
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const data = buffer.trim();
      if (data.startsWith("data: ")) {
        const content = data.slice(6).trim();
        if (content && content !== "[DONE]") {
          try {
            const parsed = JSON.parse(content);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            if (delta) {
              accumulated += delta;
              onChunk({ delta, accumulated, done: false });
            }
          } catch { /* skip */ }
        }
      }
    }

    onChunk({ delta: "", accumulated, done: true });
    return accumulated;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      onChunk({ delta: "", accumulated: "", done: true });
      return "";
    }
    throw err;
  }
}

/**
 * Run multiple AI agents for a task, one after another.
 * Returns a record of roleName → output text.
 */
export async function runAllAgents(
  task: SelectedTask,
  onChunk: (roleName: string, chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const outputs: Record<string, string> = {};

  for (const role of task.assignedAIs) {
    outputs[role.roleName] = "";
    const result = await runAgent({
      task,
      role,
      onChunk: (chunk) => {
        outputs[role.roleName] = chunk.accumulated;
        onChunk(role.roleName, chunk);
      },
      signal,
    });
    outputs[role.roleName] = result;
  }

  return outputs;
}
