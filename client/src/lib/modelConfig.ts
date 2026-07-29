/**
 * Model Configuration — The Lyceum Agent Workforce
 *
 * Maps each enterprise domain to its OpenRouter model and API key.
 * This is the single source of truth for "which model runs which domain."
 *
 * Domains:
 *   Law     → Claude Sonnet 5  (reasoning, citation, statute analysis)
 *   Finance → GPT-4o           (numbers, tables, structured financial data)
 *   Tech    → Gemini Flash 3.5 (fast iteration, code generation, debugging)
 */

export const DOMAINS = ["LAW", "FINANCE", "TECH", "MUSE", "KIMI"] as const;
export type Domain = (typeof DOMAINS)[number];

export interface ModelRoute {
  /** Display label shown in the UI */
  label: string;
  /** The OpenRouter model identifier sent in the API request body */
  model: string;
  /** Human-readable provider + model name */
  provider: string;
  /** Short description of why this model was selected for this domain */
  rationale: string;
}

/**
 * Domain → Model route table.
 * The `model` field is the OpenRouter slug (e.g. `anthropic/claude-sonnet-5`).
 * Each domain also has its own dedicated API key for billing isolation.
 */
export const MODEL_ROUTES: Record<Domain, ModelRoute> = {
  LAW: {
    label: "Law",
    model: "anthropic/claude-sonnet-5",
    provider: "Anthropic — Claude Sonnet 5",
    rationale: "Superior reasoning, citation accuracy, and long-context statute analysis",
  },
  FINANCE: {
    label: "Finance",
    model: "openai/gpt-4o",
    provider: "OpenAI — GPT-4o",
    rationale: "Structured data handling, numerical precision, and table generation",
  },
  TECH: {
    label: "Tech",
    model: "google/gemini-2.5-flash",
    provider: "Google — Gemini 2.5 Flash",
    rationale: "Fast inference, strong code generation, and debugging capability",
  },
  MUSE: {
    label: "Muse",
    model: "meta/muse-spark-1.1",
    provider: "Meta — Muse Spark 1.1",
    rationale: "Document structure analysis, section extraction, and content group classification",
  },
  KIMI: {
    label: "Kimi",
    model: "moonshot/kimi-3",
    provider: "Moonshot — KIMI 3",
    rationale: "Advanced workflow generation, task decomposition, and optimization for AI-human collaboration pipelines",
  },
};

/**
 * Get the OpenRouter API key for a given domain.
 * Falls back to the first available key if the domain-specific key is missing.
 */
export function getApiKeyForDomain(domain: Domain): string {
  const envMap: Record<Domain, string | undefined> = {
    LAW: import.meta.env.VITE_OPENROUTER_KEY_LAW,
    FINANCE: import.meta.env.VITE_OPENROUTER_KEY_FINANCE,
    TECH: import.meta.env.VITE_OPENROUTER_KEY_TECH,
    MUSE: import.meta.env.VITE_OPENROUTER_KEY_MUSE,
    KIMI: import.meta.env.VITE_OPENROUTER_KEY_KIMI,
  };

  const key = envMap[domain];
  if (key && !key.startsWith("sk-or-")) {
    console.warn(`[Lyceum] ${domain} API key looks invalid (expected sk-or-...)`);
  }
  return key || "";
}

/**
 * Get the OpenRouter base URL from environment or default.
 */
export function getOpenRouterBaseUrl(): string {
  return import.meta.env.VITE_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
}

/**
 * Complete API config for a domain call — key + model + URL ready to send.
 */
export function getDomainApiConfig(domain: Domain): {
  apiKey: string;
  model: string;
  baseUrl: string;
} {
  const route = MODEL_ROUTES[domain];
  return {
    apiKey: getApiKeyForDomain(domain),
    model: route.model,
    baseUrl: getOpenRouterBaseUrl(),
  };
}
