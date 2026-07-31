/**
 * Web + LLM security layer.
 *
 * Applied to every route the app serves. The two threat surfaces here are the
 * same two the Anthropic Cybersecurity Skills library calls out for an LLM
 * product:
 *
 *   1. WEB — clickjacking, MIME sniffing, referrer leakage, runaway clients.
 *      Covered by `securityHeaders()` and `rateLimit()`.
 *   2. LLM DATAFLOW — the client can only reach a model through this server,
 *      so the model is only as safe as the validation in front of it. Covered
 *      by `screenChatRequest()`, which validates the message shape and
 *      deterministically refuses obvious prompt-injection before any bytes go
 *      upstream. Injection screening is a guardrail, not a firewall — but a
 *      deterministic one is exactly what an audit trail can stand behind.
 *
 * Credentials policy: this layer never logs request bodies, never echoes an
 * Authorization header, and never puts a key in an error message. The
 * evidence-graph `redact()` handles the deeper redaction for audit writes.
 */

import crypto from "crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

// ── Security headers ─────────────────────────────────────────────────────────

/**
 * Browser-level protections for every response. Deliberately safe to enable
 * everywhere: none of these can break a correctly-built SPA.
 *
 * A strict Content-Security-Policy is only sent when SECURITY_CSP=1, because
 * this app loads third-party scripts (Crisp chat, Lemon Squeezy checkout,
 * Google Fonts, the analytics endpoint) and a policy that forgets one of them
 * silently breaks the live site. The header below is complete and correct for
 * the third parties the codebase currently loads; flip the flag once the
 * deployment's analytics endpoint is confirmed.
 */
export function securityHeaders(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Deny framing of our pages entirely (clickjacking). We embed Lemon
    // Squeezy's checkout as THEIR page framing OUR window, not the reverse,
    // so frame-ancestors 'none' on our responses is safe.
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    // HSTS only when actually serving over TLS (handles proxy-terminated TLS).
    // `req.secure` is true for direct TLS and (once trust proxy is set) for
    // proxy-terminated TLS.
    const proto = req.header("x-forwarded-proto") || (req.secure ? "https" : "http");
    if (proto === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (process.env.SECURITY_CSP === "1") {
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self'",
          // Crisp + Lemon Squeezy + our own bundle. 'unsafe-inline' is required
          // by Crisp's injected widget script.
          "script-src 'self' 'unsafe-inline' https://client.crisp.chat https://assets.lemonsqueezy.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob: https:",
          // SSE streaming (chat/stream) + Crisp socket + any API calls.
          "connect-src 'self' https: wss: ws:",
          "frame-src 'self' https://*.lemonsqueezy.com",
          "frame-ancestors 'none'",
          "media-src 'self' https: blob:",
          "worker-src 'self' blob:",
        ].join("; ")
      );
    }
    next();
  };
}

// ── Rate limiting (in-memory fixed window) ───────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Sweep expired buckets so an abusive key can't grow the map forever.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of Array.from(buckets)) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
// Don't hold the process open just for a sweeper.
if (typeof sweeper.unref === "function") sweeper.unref();

export interface RateLimitOptions {
  /** Window length in ms. */
  windowMs: number;
  /** Maximum requests per window. */
  max: number;
  /** Key extractor; defaults to client IP. */
  key?: (req: Request) => string;
  /** Override the 429 body message. */
  message?: string;
}

/**
 * Fixed-window limiter with a proper `Retry-After` header. In-memory by
 * design: this app runs single-instance today, and a per-instance limit that
 * is slightly generous beats a Redis dependency that never got deployed.
 */
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const keyFn = opts.key ?? ((req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown");
  const message = opts.message ?? "Too many requests. Please slow down and try again shortly.";

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: message, retryAfter });
      return;
    }
    next();
  };
}

// ── LLM dataflow guardrails ──────────────────────────────────────────────────

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"]);
const MAX_MESSAGES = 50;
const MAX_TOTAL_CHARS = 200_000;
const MAX_SINGLE_CHARS = 40_000;
const MAX_TEMPERATURE = 2;
const MAX_TOKENS = 8192;

/**
 * Deterministic prompt-injection patterns. Deliberately anchored so ordinary
 * business language (which may legitimately contain the words "system" or
 * "prompt") does not trip them — a guard that fires on normal work gets tuned
 * off, and a tuned-off guard protects nothing.
 */
const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|messages?|context|directives?)/i,
    reason: "Message attempts to discard the system instructions.",
  },
  {
    pattern: /disregard\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|messages?|context)/i,
    reason: "Message attempts to discard the system instructions.",
  },
  {
    pattern: /forget\s+(everything|all|everything you)\s+(above|before|prior|previously)/i,
    reason: "Message attempts to reset the conversation context.",
  },
  {
    // NOTE: `assistant` and `agent` are deliberately absent. "You are now the
    // finance assistant" / "You are now the sales agent" are normal system-
    // prompt phrasings, and since every role is screened, matching them would
    // 400 legitimate requests. The classic jailbreak redefines the model as
    // the *system/developer/admin* or a named model (gpt/chatgpt/claude/dan),
    // which are the terms kept below. Injection patterns are checked
    // independently, so a "you are now the assistant, ignore all previous
    // instructions" payload is still caught by the first rule.
    pattern:
      /you\s+are\s+now\s+(a|an|the|not)?\s*(system|developer|administrator|admin|gpt|chatgpt|claude|dan)\b/i,
    reason: "Message attempts to redefine the assistant's identity or role.",
  },
  {
    pattern: /<\|?(system|developer|assistant)_?(message|prompt|instruction)\|?>/i,
    reason: "Message contains a role-tag injection.",
  },
  {
    pattern: /do\s+not\s+(follow|obey|honor)\s+(any\s+|the\s+)?(rules|instructions|guidelines|constraints)/i,
    reason: "Message attempts to disable the system instructions.",
  },
  {
    pattern: /reveal\s+(your|the)\s+(system|developer)\s+(prompt|instructions?)/i,
    reason: "Message attempts to extract the system prompt.",
  },
];

/** Returns a plain-language reason if the text looks like an injection. */
export function screenPrompt(text: string): string | null {
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

export type ScreenResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/**
 * Validate + screen a chat-completions style body BEFORE it reaches the
 * provider. This is the input side of the LLM guardrail; output-side checks
 * (fact grounding, JSON schema) live in the pillars.
 */
export function screenChatRequest(body: unknown): ScreenResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, reason: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  const domain = b.domain;
  if (typeof domain !== "string" || domain.length === 0) {
    return { ok: false, status: 400, reason: "'domain' is required." };
  }

  const messages = b.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, status: 400, reason: "'messages' must be a non-empty array." };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, status: 413, reason: `'messages' exceeds the ${MAX_MESSAGES}-message limit.` };
  }

  let totalChars = 0;
  for (const m of messages) {
    if (typeof m !== "object" || m === null) {
      return { ok: false, status: 400, reason: "Each message must be an object." };
    }
    const mm = m as Record<string, unknown>;
    if (typeof mm.role !== "string" || !ALLOWED_ROLES.has(mm.role)) {
      return { ok: false, status: 400, reason: `Invalid message role: ${String(mm.role)}` };
    }
    if (typeof mm.content !== "string") {
      return { ok: false, status: 400, reason: "Each message's 'content' must be a string." };
    }
    if (mm.content.length > MAX_SINGLE_CHARS) {
      return { ok: false, status: 413, reason: `A single message exceeds ${MAX_SINGLE_CHARS} characters.` };
    }
    totalChars += mm.content.length;
    // EVERY message is screened, including assistant and system roles. This is
    // a stateless proxy: the client authors the entire messages array, so
    // there is no way to tell a genuine model echo from an attacker-authored
    // assistant message — skipping any role would hand the attacker a role to
    // hide the injection in. The rare false positive (a model refusal quoting
    // an attack phrase) is recoverable by retrying; a bypass is not. System
    // prompts the product itself builds never contain these patterns.
    const reason = screenPrompt(mm.content);
    if (reason) {
      return { ok: false, status: 400, reason: `Message blocked by LLM guardrail: ${reason}` };
    }
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return { ok: false, status: 413, reason: `Total message size exceeds ${MAX_TOTAL_CHARS} characters.` };
  }

  if (b.temperature !== undefined && (typeof b.temperature !== "number" || b.temperature > MAX_TEMPERATURE)) {
    return { ok: false, status: 400, reason: `'temperature' must be a number ≤ ${MAX_TEMPERATURE}.` };
  }
  if (
    b.maxTokens !== undefined &&
    (typeof b.maxTokens !== "number" || !Number.isFinite(b.maxTokens) || b.maxTokens > MAX_TOKENS)
  ) {
    return { ok: false, status: 400, reason: `'maxTokens' must be a number ≤ ${MAX_TOKENS}.` };
  }

  return { ok: true };
}

/**
 * Bind an OAuth-style `state` nonce to a license key. Standard practice for
 * the authorize/callback hand-off: the browser redirect cannot carry the
 * license key (it would leak in the URL), so the state token is the binding.
 * Single-use and TTL'd server-side.
 */
export interface PendingAuth {
  provider: string;
  licenseKey: string;
  mode: "real" | "sandbox";
  createdAt: number;
}

const pendingStates = new Map<string, PendingAuth>();
const STATE_TTL_MS = 10 * 60_000;

// Sweep abandoned authorizations (consent page opened, never completed) so
// the state map can't grow without bound.
const stateSweeper = setInterval(() => {
  const now = Date.now();
  for (const [state, auth] of Array.from(pendingStates)) {
    if (now - auth.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
}, 60_000);
if (typeof stateSweeper.unref === "function") stateSweeper.unref();

export function issueAuthState(auth: PendingAuth): string {
  // Lazily drop expired entries so issuing never races the sweeper window.
  const now = Date.now();
  for (const [state, a] of Array.from(pendingStates)) {
    if (now - a.createdAt > STATE_TTL_MS) pendingStates.delete(state);
  }
  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, auth);
  return state;
}

/** Consume (single-use) a pending auth state, honouring the TTL. */
export function consumeAuthState(state: string): PendingAuth | null {
  const auth = pendingStates.get(state);
  if (!auth) return null;
  pendingStates.delete(state);
  if (Date.now() - auth.createdAt > STATE_TTL_MS) return null;
  return auth;
}


// ── CORS ─────────────────────────────────────────────────────────────────────

/**
 * Strict allowlist CORS.
 *
 * Written inline rather than pulling in the `cors` package: the policy we want
 * is twenty lines of header logic, and every dependency in a governance product
 * is a supply-chain surface we then have to defend. The behaviour is
 * deliberately narrower than the library's defaults.
 *
 * Two decisions worth stating:
 *
 * - A request with no Origin header is allowed. That covers same-origin
 *   navigation, curl, and server-to-server calls — none of which the
 *   same-origin policy protects anyway, so refusing them buys nothing and
 *   breaks legitimate API clients.
 * - `credentials` is never enabled. Auth here is a Bearer token the caller
 *   attaches deliberately, not an ambient cookie, so there is no CSRF surface
 *   to protect and no reason to widen the policy for one.
 */
export function corsPolicy(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    const origin = req.headers.origin;

    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      // Caches key on Origin, so a permissive response for one origin is never
      // replayed to another.
      res.setHeader("Vary", "Origin");
    } else if (origin) {
      // Cross-origin and not on the list: send no ACAO header at all. The
      // browser blocks it. Returning 403 here would leak which origins are
      // configured, and would break preflight in a confusing way.
      if (req.method === "OPTIONS") {
        res.setHeader("Vary", "Origin");
        return res.sendStatus(204);
      }
      return next();
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
      res.setHeader("Access-Control-Max-Age", "86400");
      return res.sendStatus(204);
    }

    next();
  };
}
