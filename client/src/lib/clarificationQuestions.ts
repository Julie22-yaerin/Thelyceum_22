/**
 * Clarification Questions — Pre-Execution AI Question Generator
 *
 * Before an AI agent executes a task, it "reads" the task documentation
 * and generates a set of multiple-choice questions (with an "Other"
 * free-text option) for the human manager of that task branch.
 *
 * The questions are generated from templates keyed by task category and
 * AI role, producing relevant, role-specific MCQs. If no matching
 * template exists, a generic set of questions is used.
 *
 * Types are defined here (not in the store) to avoid circular dependencies.
 */

// ── Types (defined here to avoid circular deps with the store) ─────────────

export interface ClarificationOption {
  id: string;
  text: string;
}

export interface ClarificationQuestion {
  /** Unique ID for this question */
  id: string;
  /** The question text */
  question: string;
  /** Multiple-choice options (at least 2) */
  options: ClarificationOption[];
  /** The human's answer — either an option.id or free text if 'other' was chosen */
  answer: string | null;
  /** ISO timestamp when the human answered */
  answeredAt?: number;
  /** Whether this was auto-answered by the AI (human didn't respond in time) */
  autoAnswered?: boolean;
}

/**
 * Audit entry for auto-answered questions.
 * Records which questions were assumed by default when the human
 * didn't respond within the configured timeout.
 */
export interface AutoAnswerAuditEntry {
  /** Task ID */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Question ID */
  questionId: string;
  /** The question text */
  question: string;
  /** The default answer that was chosen (option text, not ID) */
  defaultAnswer: string;
  /** ISO timestamp when the auto-answer fired */
  timestamp: number;
  /** Whether this was part of a batch auto-answer */
  batchId: string;
}

// ── Template helpers ────────────────────────────────────────────────────────

interface QuestionTemplate {
  question: string;
  options: string[];
}

const CATEGORY_TEMPLATES: Record<string, QuestionTemplate[]> = {
  data_annotation: [
    {
      question: "What is the primary data modality for annotation?",
      options: ["Image / Video", "Text / Document", "3D / Point Cloud", "Audio / Speech"],
    },
    {
      question: "What quality threshold should the annotation pipeline enforce?",
      options: ["> 95% accuracy", "> 98% accuracy", "> 90% accuracy", "> 99% accuracy (human review)"],
    },
    {
      question: "How should edge cases / ambiguous samples be handled?",
      options: ["Flag for human review", "Skip automatically", "Use majority vote", "Log and continue"],
    },
  ],
  code_development: [
    {
      question: "What is the target language / framework for this task?",
      options: ["TypeScript / React", "Python / FastAPI", "Go / gRPC", "Rust / WebAssembly"],
    },
    {
      question: "What testing coverage threshold is required?",
      options: ["> 80% coverage", "> 90% coverage", "> 70% coverage", "Critical paths only"],
    },
    {
      question: "Should the code prioritize performance or readability?",
      options: ["Readability — clean code first", "Performance — optimize aggressively", "Balance both", "Follow existing codebase style"],
    },
  ],
  market_research: [
    {
      question: "What is the primary market / geography to analyze?",
      options: ["North America", "Europe", "Asia-Pacific", "Global (all regions)"],
    },
    {
      question: "What time horizon should the analysis cover?",
      options: ["Current quarter (0-3 months)", "Near term (3-12 months)", "Long term (1-3 years)", "Historical trend (past 2 years)"],
    },
  ],
  content_generation: [
    {
      question: "What brand voice should the content use?",
      options: ["Professional / Formal", "Casual / Conversational", "Technical / Educational", "Inspirational / Visionary"],
    },
    {
      question: "What is the target audience for this content?",
      options: ["C-level executives", "Technical practitioners", "General public", "Industry peers"],
    },
  ],
  financial: [
    {
      question: "What currency / accounting standard should be used?",
      options: ["USD — GAAP", "EUR — IFRS", "Local currency — Local GAAP", "Multi-currency with FX adjustment"],
    },
    {
      question: "What is the risk tolerance for recommendations?",
      options: ["Conservative — minimize risk", "Balanced — moderate risk", "Aggressive — pursue growth", "Follow client risk profile"],
    },
  ],
  legal: [
    {
      question: "Which jurisdiction's laws apply to this analysis?",
      options: ["United States (Federal)", "European Union (GDPR)", "United Kingdom", "Multi-jurisdictional"],
    },
  ],
};

const ROLE_TEMPLATES: Record<string, QuestionTemplate[]> = {
  "Data Extraction Specialist": [
    { question: "Should extracted data include inferred / derived fields, or only raw values?", options: ["Raw values only", "Inferred fields included", "Both, clearly labelled", "Depends on the field"] },
  ],
  "Code Generation Specialist": [
    { question: "Should generated code include unit tests?", options: ["Yes — full test suite", "Yes — critical paths only", "No — code only", "Integration tests preferred"] },
  ],
  "Legal Analyst": [
    { question: "What is the primary concern for this legal review?", options: ["Compliance / Regulatory", "Contractual liability", "Intellectual Property", "Privacy / Data protection"] },
  ],
  "Financial Analyst": [
    { question: "What level of detail is needed in the financial output?", options: ["Executive summary with key metrics", "Detailed line-item analysis", "Forecast with scenarios", "Full report with appendices"] },
  ],
};

// ── Generic fallback ────────────────────────────────────────────────────────

const GENERIC_QUESTIONS: QuestionTemplate[] = [
  {
    question: "What is the preferred output format?",
    options: ["Structured (JSON / tables)", "Prose / narrative report", "Bullet-point summary", "Mixed (structured + narrative)"],
  },
  {
    question: "How should the AI handle incomplete or ambiguous input data?",
    options: ["Flag ambiguities and ask for clarification", "Make reasonable assumptions and note them", "Skip ambiguous sections", "Process best-effort with what's available"],
  },
  {
    question: "What level of detail is expected in the output?",
    options: ["Brief — key findings only", "Standard — thorough analysis", "Comprehensive — deep dive with references", "Custom (specify below)"],
  },
];

// ── Question Builder ────────────────────────────────────────────────────────

let qIdCounter = 0;

function buildQuestion(
  template: QuestionTemplate,
  allowOther = true,
): ClarificationQuestion {
  qIdCounter++;
  const options = template.options.map((text, i) => ({
    id: `q-${qIdCounter}-opt-${i}`,
    text,
  }));
  if (allowOther) {
    options.push({
      id: `q-${qIdCounter}-other`,
      text: "Other (specify below)",
    });
  }
  return {
    id: `q-${qIdCounter}`,
    question: template.question,
    options,
    answer: null,
  };
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate clarification questions for a given task.
 *
 * Uses templates keyed by task category and assigned AI roles to produce
 * relevant, context-aware MCQs. Falls back to generic questions if no
 * specific template is found.
 *
 * Returns up to 4 questions (max 3 from category + 1 from role).
 */
/**
 * Get the sensible default answer for a question (the first option's text).
 * For "Other" options, returns a placeholder indicating custom input was assumed.
 */
export function getDefaultAnswerForQuestion(q: ClarificationQuestion): string {
  const firstRealOption = q.options.find((o) => !o.id.endsWith("-other"));
  return firstRealOption?.text ?? "Assumed default";
}

/**
 * Get the default option ID for a question (first non-other option).
 */
export function getDefaultOptionId(q: ClarificationQuestion): string | null {
  const firstRealOption = q.options.find((o) => !o.id.endsWith("-other"));
  return firstRealOption?.id ?? null;
}

export function generateQuestionsForTask(task: {
  title: string;
  description: string;
  category: string;
  assignedAIs: { roleName: string }[];
}): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const usedQuestionTexts = new Set<string>();

  const addIfNew = (template: QuestionTemplate) => {
    if (usedQuestionTexts.has(template.question)) return;
    usedQuestionTexts.add(template.question);
    questions.push(buildQuestion(template));
  };

  // 1. Category-based questions (up to 3)
  const categoryKey = task.category || "";
  const categoryQuestions = CATEGORY_TEMPLATES[categoryKey];
  if (categoryQuestions) {
    categoryQuestions.slice(0, 3).forEach(addIfNew);
  }

  // 2. Role-based questions (up to 1 per role, max 2)
  for (const ai of task.assignedAIs) {
    if (questions.length >= 4) break;
    const roleQuestions = ROLE_TEMPLATES[ai.roleName];
    if (roleQuestions && roleQuestions.length > 0) {
      addIfNew(roleQuestions[0]);
    }
  }

  // 3. Fallback: if we have fewer than 2 questions, add generic ones
  if (questions.length < 2) {
    for (const template of GENERIC_QUESTIONS) {
      if (questions.length >= 3) break;
      addIfNew(template);
    }
  }

  return questions.slice(0, 4); // Cap at 4 questions
}
