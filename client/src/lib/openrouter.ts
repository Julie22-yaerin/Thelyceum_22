/**
 * OpenRouter API Client — The Lyceum
 *
 * Routes chat completion requests to the server-side proxy at POST /api/chat.
 * The proxy attaches the API key server-side (process.env) so keys never reach
 * the browser bundle.
 *
 * Each domain gets its own API key for billing isolation and rate-limit tracking.
 *
 * Domains:
 *   Law     → Claude Sonnet 5
 *   Finance → GPT-4o
 *   Tech    → Gemini Flash 3.5
 *
 * Architecture:
 *   Browser (React) → POST /api/chat (same origin) → Server → OpenRouter API
 *   [no API keys in browser]     [keys in process.env only]
 */

import { type Domain, MODEL_ROUTES } from "./modelConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterRequestOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface OpenRouterResponse {
  id: string;
  model: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Cost in USD (OpenRouter returns this) */
    total_cost?: number;
  };
}

// ── Chat Completion (via server proxy) ───────────────────────────────────────

/**
 * Send a chat completion request to the Lyceum proxy at POST /api/chat.
 * The proxy attaches the domain's API key server-side — keys never reach the browser.
 *
 * @param domain  - Which domain to route through (LAW / FINANCE / TECH)
 * @param messages - Array of conversation messages
 * @param options  - Optional temperature, maxTokens, etc.
 *
 * @example
 *   const reply = await openRouterChat("LAW", [
 *     { role: "system", content: "You are a legal analyst." },
 *     { role: "user", content: "Summarise this contract clause." },
 *   ]);
 */
export async function openRouterChat(
  domain: Domain,
  messages: OpenRouterMessage[],
  options: OpenRouterRequestOptions = {},
): Promise<OpenRouterResponse> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain,
      messages,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    let errorBody: string;
    try {
      const errJson = await response.json() as { error?: string };
      errorBody = errJson.error || response.statusText;
    } catch {
      errorBody = await response.text().catch(() => "unknown");
    }
    throw new Error(
      `[Lyceum] /api/chat proxy returned ${response.status}: ${errorBody}`,
    );
  }

  return response.json() as Promise<OpenRouterResponse>;
}

// ── Simple Query Helper ──────────────────────────────────────────────────────

/**
 * One-shot query: send a single user message and get the text reply back.
 * All API keys stay server-side — the browser never touches them.
 */
export async function askDomainModel(
  domain: Domain,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  try {
    const result = await openRouterChat(domain, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ]);
    return result.choices[0]?.message?.content || "[empty response]";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[${MODEL_ROUTES[domain].label} error] ${message}`;
  }
}
