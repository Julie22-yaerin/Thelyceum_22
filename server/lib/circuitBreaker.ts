/**
 * The Deterministic Filtration Engine (DIRECTIVE 2).
 *
 * Pure logic. No model call anywhere in this file — that is the whole point.
 * Auditing an LLM with another LLM adds a full inference round trip to every
 * request and makes the verdict non-reproducible, so nothing here does it.
 * Every decision below is a comparison, a counter, or a regex, which is what
 * makes the verdict deterministic (same input + same counters ⇒ same verdict)
 * and what keeps the check inside single-digit milliseconds.
 *
 * Two entry points, because cost is only knowable in two parts:
 *
 *   checkBefore()  runs *before* forwarding. It can hard-block on money
 *                  already spent, call counts, velocity, loops, and payload
 *                  content. It cannot know what this call will cost yet, so it
 *                  blocks on `spent + estimate > ceiling`.
 *   recordAfter()  runs *after* the upstream responds, with real usage, and
 *                  reconciles the ledger. This is what makes the next
 *                  checkBefore() accurate.
 *
 * Honest limitation: because the true cost of a call is only known after it
 * completes, a single request can carry spend past the ceiling by at most the
 * cost of that one call. The ceiling is enforced as "no new work once over",
 * not "never exceed by a cent". Tighten by lowering the ceiling or capping
 * max_tokens upstream; there is no way to know exact cost pre-flight.
 */

import type { BreakerStore } from "./breakerStore.js";
import { memoryStore } from "./breakerStore.js";

// ── Policy ───────────────────────────────────────────────────────────────────

export interface BreakerPolicy {
  /** Hard money ceiling for the session, in cents. 0 = unlimited. */
  maxCentsPerSession: number;
  /** Hard cap on tool calls for the session. 0 = unlimited. */
  maxToolCalls: number;
  /** Token velocity ceiling — tokens per minute. 0 = unlimited. */
  maxTokensPerMinute: number;
  /** Request rate ceiling — calls per minute. 0 = unlimited. */
  maxCallsPerMinute: number;
  /** How many identical payloads inside loopWindowMs counts as a loop. */
  loopThreshold: number;
  loopWindowMs: number;
  /** Extra deny patterns on top of the built-in set. */
  extraDenyPatterns?: { code: string; pattern: RegExp; reason: string }[];
  /** MCP servers/tools this session is allowed to reach. Empty = allow all. */
  allowedMcpServers?: string[];
}

export const DEFAULT_POLICY: BreakerPolicy = {
  maxCentsPerSession: 500, // $5.00
  maxToolCalls: 50,
  maxTokensPerMinute: 120_000,
  maxCallsPerMinute: 120,
  loopThreshold: 5,
  loopWindowMs: 60_000,
};

// ── Breach vocabulary ────────────────────────────────────────────────────────

export type BreachCode =
  | "BUDGET_EXCEEDED"
  | "TOOL_CALL_LIMIT"
  | "TOKEN_VELOCITY"
  | "CALL_RATE"
  | "LOOP_DETECTED"
  | "RESTRICTED_PAYLOAD"
  | "UNAUTHORIZED_MCP";

export interface Breach {
  code: BreachCode;
  /** One sentence a human can act on, no jargon. */
  reason: string;
  /** The number that tripped, and the limit it tripped against. */
  observed: number | string;
  limit: number | string;
  /** Whether a human raising the limit can unblock this. */
  recoverable: boolean;
}

export interface Verdict {
  allowed: boolean;
  breach?: Breach;
  /** Ledger snapshot, always returned so callers can surface it. */
  state: {
    spentCents: number;
    toolCalls: number;
    tokensLastMinute: number;
    callsLastMinute: number;
  };
  /** How long the evaluation took, for SLA monitoring. */
  evaluatedInMs: number;
}

// ── Static payload analysis ──────────────────────────────────────────────────
// Regex only. These are intentionally narrow: a pattern that fires on ordinary
// prose would break the client's agent, and a proxy that false-positives is
// worse than no proxy. Each is anchored to syntax that is hard to write by
// accident.

interface DenyRule {
  code: BreachCode;
  name: string;
  pattern: RegExp;
  reason: string;
}

const DENY_RULES: DenyRule[] = [
  {
    code: "RESTRICTED_PAYLOAD",
    name: "recursive_filesystem_delete",
    // rm with a recursive+force flag pair aimed at a root-ish path.
    //
    // The target must be `/`, `~` or `$HOME` *terminated* by a delimiter, which
    // is what separates `rm -rf /` from the perfectly ordinary
    // `rm -rf ./build/tmp` or `rm -rf /tmp/cache`. The delimiter set includes
    // quotes and shell separators so the command is still caught when it is
    // nested inside JSON tool arguments — e.g. {"cmd":"rm -rf /"} — which is
    // how an agent actually emits it.
    pattern:
      /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*[rR]|-r\s+-f|-f\s+-r)\s+(?:\/|~|\$HOME)(?=[\s"'`;&|)*\\]|$)/,
    reason: "Tried to recursively delete a root or home directory.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "disk_overwrite",
    pattern: /\b(mkfs(\.\w+)?\s|dd\s+[^\n]*\bof=\/dev\/(sd|nvme|disk|hd)|>\s*\/dev\/(sd|nvme|disk|hd))/,
    reason: "Tried to format or overwrite a raw disk device.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "fork_bomb",
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: "Payload contains a fork bomb.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "pipe_to_shell",
    // curl/wget piped straight into a shell — the classic remote-exec pattern.
    pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/,
    reason: "Tried to download and execute a remote script.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "destructive_sql",
    pattern: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM\s+\w+\s*(;|$))/i,
    reason: "Tried to drop, truncate, or unconditionally delete database rows.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "credential_exfiltration",
    // Reading a known secret store and sending it somewhere in one breath.
    pattern: /(\.ssh\/id_[a-z0-9_]+|\.aws\/credentials|\.env(\.\w+)?|id_rsa)\b[^\n]{0,120}\b(curl|wget|nc|netcat|http:\/\/|https:\/\/)/i,
    reason: "Tried to read credentials and send them to a remote host.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "history_rewrite_force_push",
    pattern: /\bgit\s+push\b[^\n]*\s(--force|-f)\b[^\n]*\b(main|master|production)\b|\bgit\s+reset\s+--hard\b[^\n]*\borigin\//,
    reason: "Tried to force-push over a protected branch or hard-reset to remote.",
  },
  {
    code: "RESTRICTED_PAYLOAD",
    name: "permission_wideopen",
    pattern: /\bchmod\s+(-R\s+)?0?777\s+(\/\s*$|\/\s|\/etc|\/usr|\/var)/,
    reason: "Tried to make a system directory world-writable.",
  },
];

/** Where in a chat payload user-controlled text can hide. */
function extractText(payload: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || out.length > 400) return; // bounded: this is the hot path
    if (typeof v === "string") {
      out.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else if (v && typeof v === "object") {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
    }
  };
  walk(payload, 0);
  return out.join("\n");
}

export interface StaticFinding {
  rule: string;
  code: BreachCode;
  reason: string;
  /** Redacted excerpt so a human can see what fired without leaking secrets. */
  excerpt: string;
}

/** Scan a payload against the deny rules. Returns the first hit, or null. */
export function staticScan(
  payload: unknown,
  extra: BreakerPolicy["extraDenyPatterns"] = []
): StaticFinding | null {
  const text = extractText(payload);
  if (!text) return null;

  for (const rule of DENY_RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      return {
        rule: rule.name,
        code: rule.code,
        reason: rule.reason,
        excerpt: redact(m[0]),
      };
    }
  }
  for (const rule of extra) {
    const m = rule.pattern.exec(text);
    if (m) {
      return {
        rule: rule.code,
        code: "RESTRICTED_PAYLOAD",
        reason: rule.reason,
        excerpt: redact(m[0]),
      };
    }
  }
  return null;
}

/** Never let a matched secret reach a log or an audit record verbatim. */
export function redact(s: string): string {
  return s
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "$1-***REDACTED***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***REDACTED***")
    .replace(/\bAKIA[0-9A-Z]{12,}/g, "AKIA***REDACTED***")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "***REDACTED KEY***")
    .slice(0, 200);
}

// ── Cost model ───────────────────────────────────────────────────────────────
// Cents per 1M tokens. Only used to convert token usage into money for the
// budget ceiling. Wrong-but-conservative beats absent: unknown models fall
// back to the most expensive entry so we never under-count someone's spend.

export interface ModelPrice {
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1000 },
  "gpt-4o-mini": { inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
  "claude-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-opus": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "claude-haiku": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  "gemini-2.5-flash": { inputCentsPerMTok: 30, outputCentsPerMTok: 250 },
};

const FALLBACK_PRICE: ModelPrice = { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 };

export function priceFor(model: string): ModelPrice {
  const key = Object.keys(MODEL_PRICES).find((k) => model.toLowerCase().includes(k));
  return key ? MODEL_PRICES[key] : FALLBACK_PRICE;
}

export function costInCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  return (
    (inputTokens / 1_000_000) * p.inputCentsPerMTok +
    (outputTokens / 1_000_000) * p.outputCentsPerMTok
  );
}

/**
 * Rough token estimate for pre-flight budgeting. ~4 chars/token is the usual
 * English approximation; it is an estimate on purpose and only ever used to
 * decide "is this session already too close to its ceiling to start new work".
 */
export function estimateTokens(payload: unknown): number {
  return Math.ceil(extractText(payload).length / 4);
}

// ── The breaker ──────────────────────────────────────────────────────────────

export interface RequestContext {
  /** Stable id for the agent run being governed. */
  sessionId: string;
  /** Which tenant this belongs to (license key). Keys are namespaced by it. */
  tenantId: string;
  model: string;
  /** Parsed request body, as sent by the client's agent. */
  payload: unknown;
  /** True if this call is a tool/function execution rather than plain chat. */
  isToolCall?: boolean;
  /** MCP server being reached, if this is an MCP call. */
  mcpServer?: string;
  now?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

const k = {
  spend: (c: RequestContext) => `${c.sessionId}:spend`,
  tools: (c: RequestContext) => `${c.sessionId}:tools`,
  tokens: (c: RequestContext) => `${c.sessionId}:tokens`,
  calls: (c: RequestContext) => `${c.sessionId}:calls`,
  loop: (c: RequestContext, hash: string) => `${c.sessionId}:loop:${hash}`,
};

/** Cheap, stable hash for loop detection — not for security. */
export function payloadFingerprint(payload: unknown): string {
  const text = extractText(payload);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(36) + ":" + text.length.toString(36);
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface CircuitBreaker {
  checkBefore(ctx: RequestContext, policy?: Partial<BreakerPolicy>): Promise<Verdict>;
  recordAfter(ctx: RequestContext, usage: Usage): Promise<{ spentCents: number }>;
  /** Called when a human approves more budget from a Decision Card. */
  raiseBudget(sessionId: string, extraCents: number): Promise<void>;
  resetSession(sessionId: string): Promise<void>;
  snapshot(sessionId: string): Promise<Verdict["state"]>;
}

export function createCircuitBreaker(opts: { store?: BreakerStore } = {}): CircuitBreaker {
  const store = opts.store ?? memoryStore;

  async function snapshot(sessionId: string): Promise<Verdict["state"]> {
    const now = Date.now();
    const fake = { sessionId } as RequestContext;
    const [spend, tools, granted] = await Promise.all([
      store.get(k.spend(fake)),
      store.get(k.tools(fake)),
      store.get(`${sessionId}:granted`),
    ]);
    return {
      spentCents: spend / 100, // stored as hundredths of a cent for precision
      toolCalls: tools,
      tokensLastMinute: await store.countWindow(k.tokens(fake), now, 60_000),
      callsLastMinute: await store.countWindow(k.calls(fake), now, 60_000),
      ...(granted ? {} : {}),
    };
  }

  return {
    async checkBefore(ctx, override = {}): Promise<Verdict> {
      const startedAt = performance.now();
      const policy: BreakerPolicy = { ...DEFAULT_POLICY, ...override };
      const now = ctx.now ?? Date.now();

      // 1 — Static payload analysis. Cheapest and most absolute: a destructive
      //     command is never allowed regardless of budget, so check it first.
      const finding = staticScan(ctx.payload, policy.extraDenyPatterns);
      if (finding) {
        return {
          allowed: false,
          breach: {
            code: finding.code,
            reason: finding.reason,
            observed: finding.excerpt,
            limit: `rule:${finding.rule}`,
            // A human raising a budget cannot make `rm -rf /` acceptable.
            recoverable: false,
          },
          state: await snapshot(ctx.sessionId),
          evaluatedInMs: performance.now() - startedAt,
        };
      }

      // 2 — MCP allow-list. Explicit allow-list beats a deny-list here because
      //     the set of servers a session should reach is small and known.
      if (ctx.mcpServer && policy.allowedMcpServers && policy.allowedMcpServers.length > 0) {
        if (!policy.allowedMcpServers.includes(ctx.mcpServer)) {
          return {
            allowed: false,
            breach: {
              code: "UNAUTHORIZED_MCP",
              reason: `This agent is not allowed to reach the MCP server "${ctx.mcpServer}".`,
              observed: ctx.mcpServer,
              limit: policy.allowedMcpServers.join(", "),
              recoverable: true,
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt,
          };
        }
      }

      // 3 — Money. Spend is stored in hundredths of a cent so many small calls
      //     don't vanish into rounding.
      const spentHundredths = await store.get(k.spend(ctx));
      const grantedExtra = await store.get(`${ctx.sessionId}:granted`);
      const ceilingCents = policy.maxCentsPerSession + grantedExtra / 100;
      const spentCents = spentHundredths / 100;

      if (policy.maxCentsPerSession > 0) {
        const estimateCents = costInCents(ctx.model, estimateTokens(ctx.payload), 0);
        if (spentCents + estimateCents > ceilingCents) {
          return {
            allowed: false,
            breach: {
              code: "BUDGET_EXCEEDED",
              reason: `This task has spent $${spentCents.toFixed(2)} of its $${ceilingCents.toFixed(2)} limit.`,
              observed: Number(spentCents.toFixed(4)),
              limit: Number(ceilingCents.toFixed(4)),
              recoverable: true,
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt,
          };
        }
      }

      // 4 — Tool-call ceiling.
      if (policy.maxToolCalls > 0 && ctx.isToolCall) {
        const used = await store.get(k.tools(ctx));
        if (used >= policy.maxToolCalls) {
          return {
            allowed: false,
            breach: {
              code: "TOOL_CALL_LIMIT",
              reason: `This task has already run ${used} tool calls, its limit is ${policy.maxToolCalls}.`,
              observed: used,
              limit: policy.maxToolCalls,
              recoverable: true,
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt,
          };
        }
      }

      // 5 — Request rate.
      if (policy.maxCallsPerMinute > 0) {
        const inWindow = await store.countWindow(k.calls(ctx), now, 60_000);
        if (inWindow >= policy.maxCallsPerMinute) {
          return {
            allowed: false,
            breach: {
              code: "CALL_RATE",
              reason: `This agent is calling too fast — ${inWindow} calls in the last minute.`,
              observed: inWindow,
              limit: policy.maxCallsPerMinute,
              recoverable: true,
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt,
          };
        }
      }

      // 6 — Token velocity.
      if (policy.maxTokensPerMinute > 0) {
        const tokensInWindow = await store.countWindow(k.tokens(ctx), now, 60_000);
        if (tokensInWindow >= policy.maxTokensPerMinute) {
          return {
            allowed: false,
            breach: {
              code: "TOKEN_VELOCITY",
              reason: `This agent burned ${tokensInWindow.toLocaleString()} tokens in the last minute.`,
              observed: tokensInWindow,
              limit: policy.maxTokensPerMinute,
              recoverable: true,
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt,
          };
        }
      }

      // 7 — Loop detection: the same payload repeating is the signature of a
      //     stuck agent, which is the expensive failure this product exists to
      //     stop. Counted per-fingerprint, not globally, so a legitimately
      //     busy agent isn't punished for volume.
      if (policy.loopThreshold > 0) {
        const fp = payloadFingerprint(ctx.payload);
        const repeats = await store.pushWindow(k.loop(ctx, fp), now, policy.loopWindowMs);
        if (repeats > policy.loopThreshold) {
          return {
            allowed: false,
            breach: {
              code: "LOOP_DETECTED",
              reason: `The same request repeated ${repeats} times in ${Math.round(policy.loopWindowMs / 1000)}s — the agent looks stuck.`,
              observed: repeats,
              limit: policy.loopThreshold,
              recoverable: true,
            },
            state: await snapshot(ctx.sessionId),
            evaluatedInMs: performance.now() - startedAt,
          };
        }
      }

      // Allowed — only now do we count the call against the rate window, so a
      // blocked request doesn't consume the client's own rate budget.
      await store.pushWindow(k.calls(ctx), now, 60_000);
      if (ctx.isToolCall) await store.incr(k.tools(ctx), 1, SESSION_TTL_MS);

      return {
        allowed: true,
        state: await snapshot(ctx.sessionId),
        evaluatedInMs: performance.now() - startedAt,
      };
    },

    async recordAfter(ctx, usage) {
      const now = ctx.now ?? Date.now();
      const cents = costInCents(ctx.model, usage.inputTokens, usage.outputTokens);
      // Stored ×100 so sub-cent calls accumulate instead of rounding to zero.
      const totalHundredths = await store.incr(
        k.spend(ctx),
        Math.round(cents * 100),
        SESSION_TTL_MS
      );
      const total = usage.inputTokens + usage.outputTokens;
      // Token velocity window holds one entry per token-chunk rather than per
      // token, to keep the array small; countWindow sums entries so we push a
      // proportional number of marks (1 per 1k tokens, min 1).
      const marks = Math.max(1, Math.round(total / 1000));
      for (let i = 0; i < marks; i++) {
        await store.pushWindow(k.tokens(ctx), now, 60_000);
      }
      return { spentCents: totalHundredths / 100 };
    },

    async raiseBudget(sessionId, extraCents) {
      await memoryStoreSafeIncr(store, `${sessionId}:granted`, Math.round(extraCents * 100));
    },

    async resetSession(sessionId) {
      await store.resetSession(sessionId);
    },

    snapshot,
  };
}

async function memoryStoreSafeIncr(store: BreakerStore, key: string, by: number) {
  await store.incr(key, by, SESSION_TTL_MS);
}

/** Process-wide default instance. */
export const breaker = createCircuitBreaker();

/**
 * The structured error the agent receives. Shaped to be actionable by a
 * machine (stable `code`) and by a human reading logs (`message`), and to be
 * recognisable by OpenAI-compatible clients, which expect `error.message`.
 */
export function breachToErrorBody(breach: Breach, state: Verdict["state"], sessionId: string) {
  return {
    error: {
      // OpenAI-compatible envelope so existing SDK error handling still works.
      message: `[Lyceum] ${breach.reason}`,
      type: "lyceum_circuit_breaker",
      code: breach.code,
      param: null,
    },
    lyceum: {
      halted: true,
      sessionId,
      breach,
      state,
      /** Told plainly so an agent author knows retrying is pointless. */
      retryable: false,
      humanActionRequired: breach.recoverable,
      docs: "https://www.thelyceum.site/docs/circuit-breaker",
    },
  };
}

/** HTTP status per breach — 429 for limits, 403 for content/authorisation. */
export function breachToStatus(code: BreachCode): number {
  switch (code) {
    case "RESTRICTED_PAYLOAD":
    case "UNAUTHORIZED_MCP":
      return 403;
    case "BUDGET_EXCEEDED":
      return 402; // Payment Required — distinguishes money from rate limiting.
    default:
      return 429;
  }
}
