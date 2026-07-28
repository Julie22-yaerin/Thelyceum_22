/**
 * Document Analyzer — The Lyceum
 *
 * Uses Muse Spark 1.1 (Meta) to parse uploaded documents and extract:
 *   - Main sections / chapters
 *   - Content groups within each section (smaller topical units)
 *   - Summary and key topics per group
 *
 * This enables the AI task routing system: content groups are sent
 * as precise inputs to workforce agents — no need for agents to re-read
 * the entire document.
 *
 * Architecture:
 *   Browser → POST /api/chat { domain: "MUSE", messages } → Server → OpenRouter
 *   [content sent as system prompt + document text]
 */

import type { Domain } from "@/lib/modelConfig";
import type { DocumentSection, ContentGroup, DocAnalysis } from "@/store/useWorkspaceStore";

// ── Types ────────────────────────────────────────────────────────────────────

export type DocumentAnalysis = DocAnalysis;
export { type DocumentSection, type ContentGroup };

// ── Prompt Constants ────────────────────────────────────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `You are a document structure analyst. Given a document's filename and content, analyze it and return a JSON object with:
- "overview": A 1-2 sentence summary of the entire document
- "sections": An array of sections found in the document

Each section must have:
- "title": Section heading or topic name
- "summary": 1 sentence summarizing this section
- "groups": Array of content subgroups within this section

Each content group must have:
- "title": Specific topic name
- "content": The exact relevant excerpt or key data from the document for this group (keep it concise but complete enough that an AI agent can work with it without re-reading the full document)
- "topics": Array of 2-4 keyword tags for routing
- "suggestedAgentRole": What type of AI specialist should handle this (e.g., "Data Extraction Specialist", "Code Generation Specialist", "Legal Analyst", "Financial Analyst")

IMPORTANT: Return ONLY valid JSON. No markdown, no code fences, no explanations.`;

// ── Analyzer ─────────────────────────────────────────────────────────────────

/**
 * Analyze a document by sending its content to Muse Spark 1.1.
 * Returns structured sections and content groups ready for AI task routing.
 */
export async function analyzeDocument(
  fileName: string,
  fileContent: string,
  fileType: string,
): Promise<DocumentAnalysis> {
  const documentId = `analysis-${Date.now()}`;

  // Truncate content if too long (Muse has limited context)
  const maxContentLength = 8000;
  const truncatedContent =
    fileContent.length > maxContentLength
      ? fileContent.slice(0, maxContentLength) + "\n\n[...content truncated...]"
      : fileContent;

  const userMessage = `Analyze this document:
Filename: ${fileName}
Type: ${fileType}
Content:
${truncatedContent}`;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: "MUSE" as Domain,
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
        maxTokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "unknown");
      throw new Error(`Analysis failed: ${response.status} - ${err}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || "";

    // Parse the JSON response (handle possible markdown fences)
    let parsed: { overview?: string; sections?: DocumentSection[] };
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = JSON.parse(rawText);
    }

    return {
      documentId,
      overview: parsed.overview || "No overview generated.",
      sections: (parsed.sections || []).map((section, si) => ({
        ...section,
        id: section.id || `section-${si + 1}`,
        groups: (section.groups || []).map((group, gi) => ({
          ...group,
          id: group.id || `group-${si + 1}-${gi + 1}`,
          topics: group.topics || [],
        })),
      })),
      analyzedAt: Date.now(),
      status: "complete",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      documentId,
      overview: "",
      sections: [],
      analyzedAt: Date.now(),
      status: "error",
      error: message,
    };
  }
}

/**
 * Simulate a document analysis for demo/preview purposes
 * (used when Muse API is not available or for testing).
 */
export function simulateAnalysis(fileName: string): DocumentAnalysis {
  const documentId = `analysis-${Date.now()}`;
  const name = fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");

  return {
    documentId,
    overview: `Analysis of "${fileName}" — identified ${3 + Math.floor(Math.random() * 3)} major sections covering key topics related to ${name}.`,
    sections: [
      {
        id: "section-1",
        title: "Executive Overview",
        summary: `High-level summary of ${name} with key metrics and strategic direction`,
        groups: [
          {
            id: "group-1-1",
            title: "Strategic Objectives",
            content: `Core strategic objectives identified in ${name}: market expansion, operational efficiency, and technology adoption. Key metrics show 15% growth target in Q3.`,
            topics: ["strategy", "objectives", "growth"],
            suggestedAgentRole: "Executive Strategist",
          },
          {
            id: "group-1-2",
            title: "Key Performance Indicators",
            content: `Primary KPIs: Revenue growth (15%), Customer satisfaction (92%), Time-to-market (45 days), Cost reduction (8%). Current performance against targets: 87% on track.`,
            topics: ["kpi", "metrics", "performance"],
            suggestedAgentRole: "Real-time Analytics Agent",
          },
        ],
      },
      {
        id: "section-2",
        title: "Detailed Analysis",
        summary: `In-depth breakdown of operational data, financial figures, and technical specifications`,
        groups: [
          {
            id: "group-2-1",
            title: "Financial Data",
            content: `Quarterly financial breakdown: Revenue $2.4M (+12% QoQ), Operating costs $1.8M, Net margin 25%. Major cost drivers: Engineering (40%), Marketing (25%), Operations (20%).`,
            topics: ["finance", "revenue", "costs"],
            suggestedAgentRole: "Data Extraction Specialist",
          },
          {
            id: "group-2-2",
            title: "Technical Specifications",
            content: `System architecture overview: Microservices-based deployment with 12 services, React frontend, Node.js backend, PostgreSQL database. Average response time 240ms, uptime 99.97%.`,
            topics: ["technical", "architecture", "performance"],
            suggestedAgentRole: "Code Generation Specialist",
          },
        ],
      },
      {
        id: "section-3",
        title: "Recommendations & Next Steps",
        summary: `Actionable recommendations derived from document analysis`,
        groups: [
          {
            id: "group-3-1",
            title: "Action Items",
            content: `Priority actions: (1) Optimize database queries for 30% faster response, (2) Implement automated testing pipeline, (3) Expand market presence to APAC region by Q4.`,
            topics: ["actions", "priorities"],
            suggestedAgentRole: "Quality Router",
          },
        ],
      },
    ],
    analyzedAt: Date.now(),
    status: "complete",
  };
}
