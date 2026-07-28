/**
 * Model Pricing — The Lyceum
 *
 * Fetches model metadata and per-token pricing from the OpenRouter /models
 * endpoint and caches the result in memory for 5 minutes.
 *
 * Pricing is returned as strings of USD per token (e.g. "0.000003").
 * Multiply by 1,000 to get cost per 1K tokens for display.
 */

import { getOpenRouterBaseUrl, getApiKeyForDomain, type Domain } from "./modelConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    /** Cost per prompt token as a string (e.g. "0.000003") */
    prompt: string;
    /** Cost per completion token as a string (e.g. "0.000015") */
    completion: string;
    /** Cost per image (if applicable) */
    image?: string;
    /** Cost per request (if applicable) */
    request?: string;
  };
  context_length: number;
  architecture?: {
    modality: string;
    tokenizer: string;
    instruct_type: string | null;
  };
  top_provider?: {
    max_completion_tokens: number;
    is_moderated: boolean;
  };
}

interface ModelsResponse {
  data: OpenRouterModel[];
}

// ── Cache ────────────────────────────────────────────────────────────────────

let cachedModels: OpenRouterModel[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Determine which API key to use for fetching the models list.
 * Prefers the LAW key since it tends to be the most provisioned.
 */
function getBestAvailableKey(): string {
  const domains: Domain[] = ["LAW", "FINANCE", "TECH"];
  for (const domain of domains) {
    const key = getApiKeyForDomain(domain);
    if (key) return key;
  }
  return "";
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch the full model catalog from OpenRouter.
 * Results are cached in memory for 5 minutes.
 *
 * @param forceRefresh - Bypass cache and re-fetch from the API
 */
export async function fetchModelCatalog(forceRefresh = false): Promise<OpenRouterModel[]> {
  if (!forceRefresh && cachedModels && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels;
  }

  const apiKey = getBestAvailableKey();
  if (!apiKey) {
    throw new Error(
      "[Lyceum] No OpenRouter API key available. Set at least one VITE_OPENROUTER_KEY_* in your .env file.",
    );
  }

  const baseUrl = getOpenRouterBaseUrl();
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `[Lyceum] OpenRouter /models returned ${response.status}: ${await response.text().catch(() => "unknown")}`,
    );
  }

  const body = (await response.json()) as ModelsResponse;
  const models = body.data || [];

  // Sort alphabetically by provider then name for consistent display
  models.sort((a, b) => a.id.localeCompare(b.id));

  cachedModels = models;
  cacheTimestamp = Date.now();

  return models;
}

/**
 * Format a per-token price string (e.g. "0.000003") as a human-readable
 * per-1K-tokens string (e.g. "$3.00").
 * Output formats:
 *   - $0.05 (>= $0.01)
 *   - $0.005 (< $0.01, >= $0.001)
 *   - $0.0005 (< $0.001, >= $0.0001)
 *   - $0.00015 USD/token (very small)
 */
export function formatPricePer1K(costPerToken: string): string {
  const perToken = Number.parseFloat(costPerToken);
  if (Number.isNaN(perToken) || perToken <= 0) return "—";

  const per1K = perToken * 1000;

  if (per1K >= 0.01) {
    return `$${per1K.toFixed(2)}`;
  }
  if (per1K >= 0.001) {
    return `$${per1K.toFixed(3)}`;
  }
  if (per1K >= 0.0001) {
    return `$${per1K.toFixed(4)}`;
  }
  return `$${perToken.toFixed(6)}/token`;
}

/**
 * Get the estimated cost of a single call given token counts.
 * Returns USD cost.
 */
export function estimateCallCost(
  model: OpenRouterModel,
  promptTokens: number,
  completionTokens: number,
): number {
  const promptCost = Number.parseFloat(model.pricing.prompt) * promptTokens;
  const completionCost = Number.parseFloat(model.pricing.completion) * completionTokens;
  return promptCost + completionCost;
}

/**
 * Format a USD cost value for display.
 */
export function formatUsd(cost: number): string {
  if (cost >= 100) return `$${cost.toFixed(0)}`;
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `¢${(cost * 100).toFixed(1)}`;
  return `¢${(cost * 100).toFixed(2)}`;
}

/**
 * Clear the in-memory cache (useful for testing or forced refresh).
 */
export function clearModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
}
