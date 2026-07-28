import { MODEL_ROUTES, type Domain } from "../../client/src/lib/modelConfig.js";

export const KEY_MAP: Record<Domain, string> = {
  LAW: process.env.OPENROUTER_KEY_LAW || process.env.VITE_OPENROUTER_KEY_LAW || "",
  FINANCE: process.env.OPENROUTER_KEY_FINANCE || process.env.VITE_OPENROUTER_KEY_FINANCE || "",
  TECH: process.env.OPENROUTER_KEY_TECH || process.env.VITE_OPENROUTER_KEY_TECH || "",
  MUSE: process.env.OPENROUTER_KEY_MUSE || process.env.VITE_OPENROUTER_KEY_MUSE || "",
};

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ProxyRequestBody {
  domain: Domain;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export async function proxyToOpenRouter(body: ProxyRequestBody): Promise<unknown> {
  const { domain, messages, temperature, maxTokens } = body;

  const apiKey = KEY_MAP[domain];
  if (!apiKey) {
    throw new Error(`No API key configured for domain "${domain}"`);
  }

  const route = MODEL_ROUTES[domain];
  if (!route) {
    throw new Error(`Unknown domain "${domain}"`);
  }

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://lyceum.internal",
      "X-Title": "The Lyceum",
    },
    body: JSON.stringify({
      model: route.model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown");
    throw new Error(`OpenRouter (${domain}) returned ${response.status}: ${text}`);
  }

  return response.json();
}

/** Pulls the assistant's plain-text reply out of an OpenRouter chat completion. */
export function extractReplyText(completion: unknown): string {
  const choice = (completion as any)?.choices?.[0]?.message?.content;
  return typeof choice === "string" ? choice : JSON.stringify(completion);
}
