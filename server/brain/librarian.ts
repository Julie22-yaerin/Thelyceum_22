/**
 * The Librarian — files new material into the right department.
 *
 * A knowledge base only stays useful if filing is free. If a human has to
 * choose a folder for every document, the folders drift and the scope rules
 * that depend on them quietly stop meaning anything.
 *
 * Two-stage on purpose:
 *   1. A deterministic keyword classifier that always runs and always answers.
 *   2. An LLM pass that can override it — but only within the fixed department
 *      set, and only when it clears a confidence floor.
 *
 * The LLM never invents a destination. It picks from an enum, and anything it
 * returns that is not in that enum is discarded in favour of stage 1. This
 * matters because the destination determines who can read the document: a
 * hallucinated folder is a data-leak primitive, not a filing mistake.
 *
 * With no key configured the librarian still works, just deterministically.
 * Filing must never be blocked on a provider being reachable.
 */

import { DEPARTMENTS, putDocument, type DepartmentId } from "./knowledge.js";
import { tokenise } from "./contextRouter.js";

/** Signals per department. Chosen to be words that are rare outside the domain. */
const SIGNALS: Record<DepartmentId, string[]> = {
  finance: [
    "price", "pricing", "cost", "margin", "revenue", "invoice", "billing",
    "usd", "$", "budget", "discount", "tier", "subscription", "refund", "tax",
  ],
  dev_ops: [
    "api", "endpoint", "latency", "sla", "uptime", "deploy", "server", "proxy",
    "failover", "breaker", "timeout", "throughput", "incident", "runbook", "config",
  ],
  sales_outreach: [
    "pitch", "outreach", "prospect", "lead", "linkedin", "campaign", "demo",
    "objection", "cold", "script", "positioning", "icp", "funnel", "crm",
  ],
  qa_compliance: [
    "schema", "validation", "compliance", "audit", "benchmark", "policy",
    "grounding", "hallucination", "test", "gdpr", "consent", "retention",
  ],
};

export interface Classification {
  department: DepartmentId;
  confidence: number;
  /** How it was decided — surfaced to the operator, never hidden. */
  method: "keyword" | "model";
  reasoning: string;
}

/** Stage 1: always available, never wrong in an interesting way. */
export function classifyByKeyword(title: string, body: string): Classification {
  const terms = tokenise(`${title} ${title} ${body}`); // title double-weighted
  const counts = new Map<DepartmentId, number>();

  for (const dept of Object.keys(SIGNALS) as DepartmentId[]) {
    const signals = new Set(SIGNALS[dept]);
    let hits = 0;
    for (const t of terms) if (signals.has(t)) hits++;
    counts.set(dept, hits);
  }

  const ranked = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const [top, topScore] = ranked[0];
  const secondScore = ranked[1]?.[1] ?? 0;

  // Confidence is the margin over the runner-up, not the raw hit count: a
  // document hitting "api" ten times and "price" nine times is genuinely
  // ambiguous no matter how many total hits it has.
  const margin = topScore - secondScore;
  const confidence = topScore === 0 ? 0 : Math.min(0.9, 0.4 + margin * 0.1);

  return {
    department: top,
    confidence,
    method: "keyword",
    reasoning:
      topScore === 0
        ? "No domain signals found; defaulted by name order."
        : `Matched ${topScore} ${top} signal(s), ${secondScore} for the next closest.`,
  };
}

// ── Stage 2: model ───────────────────────────────────────────────────────────

const LIBRARIAN_MODEL = process.env.LYCEUM_LIBRARIAN_MODEL || "anthropic/claude-3.5-haiku";

/**
 * Filing is a short, well-specified classification, so this deliberately runs a
 * small fast model rather than a frontier one. Spending Opus-money to choose
 * between four folders is how an ops layer stops paying for itself.
 */
async function classifyByModel(
  title: string,
  body: string,
  signal?: AbortSignal
): Promise<Classification | null> {
  const key = process.env.LYCEUM_LIBRARIAN_KEY;
  if (!key) return null;

  const options = DEPARTMENTS.map((d) => `- ${d.id}: ${d.blurb}`).join("\n");
  const prompt = `Classify this document into exactly one department.

${options}

Reply with ONLY a JSON object: {"department":"<id>","confidence":<0-1>,"reason":"<one sentence>"}
Use one of the exact ids listed. If genuinely unclear, use low confidence.

Title: ${title}

${body.slice(0, 4000)}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LIBRARIAN_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
      signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as {
      department?: string;
      confidence?: number;
      reason?: string;
    };

    // The enum check is the security boundary: a returned folder that isn't in
    // the known set is discarded, not created.
    const valid = DEPARTMENTS.some((d) => d.id === parsed.department);
    if (!valid) return null;

    return {
      department: parsed.department as DepartmentId,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      method: "model",
      reasoning: parsed.reason || "Model classification.",
    };
  } catch {
    return null; // provider down, bad JSON, timeout — stage 1 already answered
  }
}

// ── Filing ───────────────────────────────────────────────────────────────────

/** Below this the model's opinion isn't worth overriding a deterministic answer. */
const MODEL_OVERRIDE_FLOOR = 0.6;

export async function classify(title: string, body: string): Promise<Classification> {
  const keyword = classifyByKeyword(title, body);
  const model = await classifyByModel(title, body);
  if (model && model.confidence >= MODEL_OVERRIDE_FLOOR) return model;
  return keyword;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "untitled";
}

export interface FileResult {
  path: string;
  classification: Classification;
  /** True when the operator should confirm — low confidence, not a hard failure. */
  needsReview: boolean;
}

/**
 * File a new document. Always lands somewhere: an unfiled document is invisible
 * to every agent, which is worse than a document filed imperfectly and flagged.
 */
export async function fileDocument(params: {
  licenseKey: string;
  title: string;
  body: string;
  /** Skip classification when a human already chose. */
  department?: DepartmentId;
}): Promise<FileResult> {
  const { licenseKey, title, body } = params;

  const classification: Classification = params.department
    ? {
        department: params.department,
        confidence: 1,
        method: "keyword",
        reasoning: "Department chosen by a person.",
      }
    : await classify(title, body);

  const docPath = `departments/${classification.department}/${slugify(title)}.md`;

  await putDocument({
    licenseKey,
    path: docPath,
    title,
    body,
    origin: params.department ? "upload" : "librarian",
  });

  return {
    path: docPath,
    classification,
    needsReview: classification.confidence < MODEL_OVERRIDE_FLOOR,
  };
}
