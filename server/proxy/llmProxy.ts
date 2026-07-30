/**
 * The Zero-Touch Proxy Layer (DIRECTIVE 1).
 *
 * A drop-in replacement for an LLM provider base URL. The client's only change
 * is the string they pass as `baseURL`:
 *
 *   const openai = new OpenAI({
 *     apiKey: process.env.OPENAI_API_KEY,               // unchanged — BYOK
 *     baseURL: "https://proxy.thelyceum.ai/t/lyc_live_abc123/v1",
 *   });
 *
 * No SDK, no wrapper, no refactor. Every request is evaluated by the
 * deterministic breaker and forwarded only if it passes.
 *
 * ── Why the tenant token lives in the URL path ──────────────────────────────
 * "Zero code refactoring" rules out asking the client to add a header, because
 * adding a header IS a code change in every SDK. The base URL is the one string
 * they were always going to change, so the tenant identifier rides in it. Three
 * identification paths are supported, in priority order:
 *
 *   1. Path token   /t/<token>/v1/...      ← preferred, truly zero-touch
 *   2. Header       x-lyceum-key: <token>  ← for clients that can set headers
 *   3. Key mapping  the client's own upstream key fingerprint, registered once
 *
 * ── Credential handling (read this before deploying) ────────────────────────
 * Because this is a passthrough, the client's real provider key transits this
 * process in the Authorization header. That makes us a credential path, and it
 * is treated accordingly:
 *   - the upstream Authorization header is forwarded and never written to a
 *     log, a metric, or the evidence graph;
 *   - only a salted fingerprint (first 8 chars of a SHA-256) is recorded, so
 *     usage can be attributed to a key without storing the key;
 *   - request bodies are redacted through `redact()` before any audit write.
 * If the deployment cannot honour those, do not enable this proxy.
 */

import crypto from "crypto";
import express from "express";
import {
  breaker,
  breachToErrorBody,
  breachToStatus,
  redact,
  type BreakerPolicy,
  type RequestContext,
} from "../lib/circuitBreaker.js";
import { recordProxyCall, recordBreach } from "../db/evidenceGraph.js";

// ── Upstream routing ─────────────────────────────────────────────────────────

/**
 * Which provider a request is destined for. Chosen by explicit config first,
 * then inferred from the model name, because a client swapping only the base
 * URL gives us no other signal.
 */
export const UPSTREAMS = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api",
  google: "https://generativelanguage.googleapis.com",
} as const;

export type UpstreamName = keyof typeof UPSTREAMS;

export function inferUpstream(model: string | undefined, fallback: UpstreamName): UpstreamName {
  if (!model) return fallback;
  const m = model.toLowerCase();
  if (m.startsWith("claude") || m.includes("anthropic")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.startsWith("gemini")) return "google";
  if (m.includes("/")) return "openrouter"; // provider/model form
  return fallback;
}

// ── Tenant resolution ────────────────────────────────────────────────────────

export interface ProxyTenant {
  token: string;
  licenseKey: string;
  /** Where to send traffic when the model name is ambiguous. */
  defaultUpstream: UpstreamName;
  policy: Partial<BreakerPolicy>;
}

/**
 * Resolves a proxy token to a tenant + its governance policy. Injected so the
 * proxy has no opinion about where tenants are stored (Firestore today).
 */
export type TenantResolver = (token: string) => Promise<ProxyTenant | null>;

/** Non-reversible key fingerprint for attribution without custody. */
export function fingerprintKey(authHeader: string | undefined): string {
  if (!authHeader) return "none";
  const salt = process.env.LYCEUM_FINGERPRINT_SALT ?? "";
  if (!salt) {
    // Fail loud rather than emit a rainbow-table-able hash of a live API key.
    return "unsalted";
  }
  return crypto.createHash("sha256").update(salt).update(authHeader).digest("hex").slice(0, 8);
}

/**
 * Session identity. Governance limits are per agent run, and a zero-touch
 * client can't add a session header, so we accept several signals:
 *   1. `x-lyceum-session` header, if the client can set one
 *   2. OpenAI's own `user` field, which agent frameworks commonly populate
 *   3. the tenant token + key fingerprint, i.e. one shared session per key
 * (3) is coarse: two concurrent agent runs on the same key share one budget.
 * That is stated in the docs rather than hidden, because a shared ceiling is
 * safe (it under-spends) while a wrongly-split one is not.
 */
export function resolveSessionId(
  req: express.Request,
  tenant: ProxyTenant,
  body: Record<string, unknown>
): string {
  const header = req.header("x-lyceum-session");
  if (header) return `${tenant.token}:${header}`;
  const user = typeof body.user === "string" ? body.user : undefined;
  if (user) return `${tenant.token}:user:${user}`;
  return `${tenant.token}:default:${fingerprintKey(req.header("authorization"))}`;
}

// ── Middleware ───────────────────────────────────────────────────────────────

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "content-length",
]);

/** Headers we refuse to forward upstream (ours, not the provider's). */
const LYCEUM_HEADERS = new Set(["x-lyceum-key", "x-lyceum-session"]);

function forwardableHeaders(req: express.Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || LYCEUM_HEADERS.has(lower)) continue;
    if (typeof value === "string") out[name] = value;
    else if (Array.isArray(value)) out[name] = value.join(", ");
  }
  return out;
}

export interface ProxyOptions {
  resolveTenant: TenantResolver;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

export function createProxyRouter(opts: ProxyOptions): express.Router {
  const router = express.Router();
  const doFetch = opts.fetchImpl ?? fetch;

  // Raw body: we must forward the client's bytes unchanged (signatures,
  // exact float formatting, provider-specific fields we don't model), while
  // still parsing a copy for governance.
  const rawJson = express.raw({ type: () => true, limit: "20mb" });

  const handler: express.RequestHandler = async (req, res) => {
    const startedAt = performance.now();

    // 1 — Identify the tenant.
    const token = (req.params.token as string | undefined) ?? req.header("x-lyceum-key");
    if (!token) {
      res.status(401).json({
        error: {
          message:
            "[Lyceum] Missing proxy token. Point your baseURL at https://proxy.thelyceum.ai/t/<your-token>/v1",
          type: "lyceum_config",
          code: "MISSING_PROXY_TOKEN",
        },
      });
      return;
    }

    const tenant = await opts.resolveTenant(token);
    if (!tenant) {
      res.status(401).json({
        error: {
          message: "[Lyceum] Unknown proxy token.",
          type: "lyceum_config",
          code: "UNKNOWN_PROXY_TOKEN",
        },
      });
      return;
    }

    // 2 — Parse a copy of the payload for governance. A body we can't parse is
    //     forwarded ungoverned only if it isn't JSON; unparseable JSON is
    //     rejected, because silently skipping the breaker is the one failure
    //     mode this product cannot have.
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const contentType = req.header("content-type") ?? "";
    let body: Record<string, unknown> = {};
    if (contentType.includes("json") && rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({
          error: {
            message: "[Lyceum] Request body is not valid JSON, so it cannot be governed.",
            type: "lyceum_config",
            code: "UNPARSEABLE_BODY",
          },
        });
        return;
      }
    }

    const model = typeof body.model === "string" ? body.model : undefined;
    const sessionId = resolveSessionId(req, tenant, body);
    const isStream = body.stream === true;
    const isToolCall = Array.isArray(body.tools) || Array.isArray((body as any).functions);

    const ctx: RequestContext = {
      sessionId,
      tenantId: tenant.licenseKey,
      model: model ?? "unknown",
      payload: body,
      isToolCall,
      mcpServer: req.header("x-lyceum-mcp-server") ?? undefined,
    };

    // 3 — DETERMINISTIC FILTRATION. Nothing reaches the provider before this.
    const verdict = await breaker.checkBefore(ctx, tenant.policy);

    if (!verdict.allowed && verdict.breach) {
      const status = breachToStatus(verdict.breach.code);
      const payload = breachToErrorBody(verdict.breach, verdict.state, sessionId);

      // Evidence: a blocked call is the most important thing to record.
      await recordBreach({
        licenseKey: tenant.licenseKey,
        sessionId,
        model: ctx.model,
        breach: verdict.breach,
        state: verdict.state,
        redactedExcerpt: redact(JSON.stringify(body).slice(0, 2000)),
        evaluatedInMs: verdict.evaluatedInMs,
      }).catch(() => {
        // Never let an audit write failure change the enforcement decision.
      });

      res
        .status(status)
        .set("x-lyceum-decision", "blocked")
        .set("x-lyceum-breach", verdict.breach.code)
        .set("x-lyceum-eval-ms", verdict.evaluatedInMs.toFixed(2))
        .json(payload);
      return;
    }

    // 4 — Forward upstream, bytes unchanged.
    const upstreamName = inferUpstream(model, tenant.defaultUpstream);
    const upstreamBase = UPSTREAMS[upstreamName];
    // Express 4 exposes an unnamed `*` capture as params[0] — everything after
    // /v1/, e.g. "chat/completions" or "embeddings".
    const suffix = (req.params as Record<string, string>)[0] ?? "";
    // Query string is taken from originalUrl: inside a mounted router req.url
    // has already been rewritten relative to the mount point.
    const qIndex = req.originalUrl.indexOf("?");
    const query = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
    const upstreamUrl = `${upstreamBase}/v1/${suffix}${query}`;

    let upstreamRes: Response;
    try {
      upstreamRes = await doFetch(upstreamUrl, {
        method: req.method,
        headers: forwardableHeaders(req),
        body: req.method === "GET" || req.method === "HEAD" ? undefined : rawBody,
      });
    } catch (err) {
      res.status(502).json({
        error: {
          message: `[Lyceum] Could not reach ${upstreamName}: ${err instanceof Error ? err.message : "unknown"}`,
          type: "lyceum_upstream",
          code: "UPSTREAM_UNREACHABLE",
        },
      });
      return;
    }

    // Mirror the provider's status and headers so the client SDK behaves
    // exactly as it would talking to the provider directly.
    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name.toLowerCase())) res.setHeader(name, value);
    });
    res.setHeader("x-lyceum-decision", "allowed");
    res.setHeader("x-lyceum-eval-ms", verdict.evaluatedInMs.toFixed(2));
    res.setHeader("x-lyceum-session", sessionId);

    // 5 — Stream or buffer, reconciling real usage either way.
    if (isStream && upstreamRes.body) {
      await pipeAndMeter(upstreamRes, res, ctx, {
        licenseKey: tenant.licenseKey,
        sessionId,
        upstream: upstreamName,
        keyFingerprint: fingerprintKey(req.header("authorization")),
        startedAt,
        verdict,
        body,
      });
      return;
    }

    const text = await upstreamRes.text();
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const parsed = JSON.parse(text);
      usage = readUsage(parsed);
    } catch {
      // Non-JSON response (an error page, a binary) — nothing to meter.
    }
    const after = await breaker.recordAfter(ctx, usage);

    await recordProxyCall({
      licenseKey: tenant.licenseKey,
      sessionId,
      model: ctx.model,
      upstream: upstreamName,
      keyFingerprint: fingerprintKey(req.header("authorization")),
      status: upstreamRes.status,
      usage,
      spentCentsAfter: after.spentCents,
      latencyMs: performance.now() - startedAt,
      evaluatedInMs: verdict.evaluatedInMs,
      redactedRequest: redact(JSON.stringify(body).slice(0, 2000)),
    }).catch(() => {});

    res.send(text);
  };

  // Path-token form (preferred): /t/<token>/v1/<anything>
  router.all("/t/:token/v1/*", rawJson, handler);
  // Header form, for clients that can set one: /v1/<anything>
  router.all("/v1/*", rawJson, handler);

  return router;
}

// ── Usage extraction ─────────────────────────────────────────────────────────

/** Both OpenAI and Anthropic shapes, so one proxy covers both. */
export function readUsage(parsed: unknown): { inputTokens: number; outputTokens: number } {
  const u = (parsed as any)?.usage;
  if (!u) return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    outputTokens: u.completion_tokens ?? u.output_tokens ?? 0,
  };
}

/**
 * Pass an SSE stream straight through to the client while watching for the
 * usage block that providers emit in the final chunk. The client sees an
 * untouched stream; we still get an accurate ledger.
 */
async function pipeAndMeter(
  upstreamRes: Response,
  res: express.Response,
  ctx: RequestContext,
  meta: {
    licenseKey: string;
    sessionId: string;
    upstream: string;
    keyFingerprint: string;
    startedAt: number;
    verdict: { evaluatedInMs: number };
    body: Record<string, unknown>;
  }
) {
  const reader = upstreamRes.body!.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  let usage = { inputTokens: 0, outputTokens: 0 };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      // Keep only the last ~8KB: the usage block is in the final events, and
      // buffering a whole long completion would waste memory per request.
      tail = (tail + decoder.decode(value, { stream: true })).slice(-8192);
    }
  } finally {
    res.end();
  }

  for (const line of tail.split("\n")) {
    const trimmed = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!trimmed || trimmed === "[DONE]" || !trimmed.startsWith("{")) continue;
    try {
      const found = readUsage(JSON.parse(trimmed));
      if (found.inputTokens || found.outputTokens) usage = found;
    } catch {
      // Partial JSON at the buffer boundary — expected, skip it.
    }
  }

  const after = await breaker.recordAfter(ctx, usage);
  await recordProxyCall({
    licenseKey: meta.licenseKey,
    sessionId: meta.sessionId,
    model: ctx.model,
    upstream: meta.upstream,
    keyFingerprint: meta.keyFingerprint,
    status: upstreamRes.status,
    usage,
    spentCentsAfter: after.spentCents,
    latencyMs: performance.now() - meta.startedAt,
    evaluatedInMs: meta.verdict.evaluatedInMs,
    redactedRequest: redact(JSON.stringify(meta.body).slice(0, 2000)),
    streamed: true,
  }).catch(() => {});
}
