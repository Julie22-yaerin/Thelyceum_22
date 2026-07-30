/**
 * Tests for the Zero-Touch Proxy.
 *
 * The two properties that matter and are easy to break:
 *   1. Transparency — a passing request must reach the provider byte-identical,
 *      with the client's own auth, and come back with the provider's status.
 *      If we mangle it, the customer's "just change the base URL" promise dies.
 *   2. Containment — a failing request must never reach the provider at all,
 *      and the customer's API key must never appear in an audit record.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";

// Firestore is stubbed: the proxy writes evidence, and an audit outage must
// never change an enforcement decision — which is itself asserted below.
const evidenceWrites: { kind: string; payload: unknown; summary: string }[] = [];
let evidenceShouldFail = false;

vi.mock("../db/evidenceGraph.js", () => ({
  recordProxyCall: async (input: Record<string, unknown>) => {
    if (evidenceShouldFail) throw new Error("firestore down");
    evidenceWrites.push({ kind: "proxy_call", payload: input, summary: String(input.model) });
    return { id: "node-1" };
  },
  recordBreach: async (input: Record<string, unknown>) => {
    if (evidenceShouldFail) throw new Error("firestore down");
    evidenceWrites.push({ kind: "breach", payload: input, summary: "breach" });
    return { id: "node-2" };
  },
}));

const { createProxyRouter, inferUpstream, readUsage, fingerprintKey } = await import(
  "../proxy/llmProxy.js"
);
const { breaker } = await import("../lib/circuitBreaker.js");

const TOKEN = "lyc_live_testtoken";

/** Records what the "provider" received so transparency can be asserted. */
interface UpstreamCapture {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

let captured: UpstreamCapture[] = [];
let upstreamResponse: () => Response;

const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  captured.push({
    url: String(url),
    method: init?.method ?? "GET",
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? Buffer.from(init.body as Buffer).toString("utf8") : "",
  });
  return upstreamResponse();
}) as typeof fetch;

let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  captured = [];
  evidenceWrites.length = 0;
  evidenceShouldFail = false;
  process.env.LYCEUM_FINGERPRINT_SALT = "test-salt";

  upstreamResponse = () =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-1",
        choices: [{ message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "up-1" } }
    );

  const app = express();
  app.use(
    createProxyRouter({
      fetchImpl: fakeFetch,
      resolveTenant: async (token) =>
        token === TOKEN
          ? {
              token,
              licenseKey: "lic-1",
              defaultUpstream: "openai",
              // Generous defaults; individual tests tighten what they need.
              policy: { maxCentsPerSession: 0, maxCallsPerMinute: 0, loopThreshold: 0 },
            }
          : null,
    })
  );

  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-customer-key", ...headers },
    body: JSON.stringify(body),
  });
}

const chat = (content: string, extra: Record<string, unknown> = {}) => ({
  model: "gpt-4o",
  messages: [{ role: "user", content }],
  ...extra,
});

// ── Zero-touch behaviour ────────────────────────────────────────────────────

describe("zero-touch transparency", () => {
  it("forwards a passing request to the provider and mirrors the response", async () => {
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("hello"));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-lyceum-decision")).toBe("allowed");
    // The provider's own headers survive, so client SDKs behave unchanged.
    expect(res.headers.get("x-request-id")).toBe("up-1");
    expect((await res.json()).choices[0].message.content).toBe("ok");

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("forwards the client's own Authorization header untouched (BYOK)", async () => {
    await post(`/t/${TOKEN}/v1/chat/completions`, chat("hello"));
    expect(captured[0].headers.authorization).toBe("Bearer sk-customer-key");
  });

  it("forwards the body byte-identically", async () => {
    const body = chat("keep me exact", { temperature: 0.30000001, top_p: 1 });
    await post(`/t/${TOKEN}/v1/chat/completions`, body);
    expect(captured[0].body).toBe(JSON.stringify(body));
  });

  it("strips Lyceum's own headers so the provider never sees them", async () => {
    await post(`/t/${TOKEN}/v1/chat/completions`, chat("hi"), {
      "x-lyceum-session": "run-7",
      "x-lyceum-key": "should-not-forward",
    });
    const sent = Object.keys(captured[0].headers).map((h) => h.toLowerCase());
    expect(sent).not.toContain("x-lyceum-session");
    expect(sent).not.toContain("x-lyceum-key");
  });

  it("passes the provider's error status straight through", async () => {
    upstreamResponse = () =>
      new Response(JSON.stringify({ error: { message: "rate limited upstream" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("hi"));
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("rate limited upstream");
  });

  it("returns 502 rather than hanging when the provider is unreachable", async () => {
    upstreamResponse = () => {
      throw new Error("ECONNREFUSED");
    };
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("hi"));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_UNREACHABLE");
  });

  it("routes by model name when the tenant default doesn't apply", () => {
    expect(inferUpstream("claude-sonnet-5", "openai")).toBe("anthropic");
    expect(inferUpstream("gpt-4o", "anthropic")).toBe("openai");
    expect(inferUpstream("gemini-2.5-flash", "openai")).toBe("google");
    expect(inferUpstream("meta/llama-3", "openai")).toBe("openrouter");
    expect(inferUpstream(undefined, "anthropic")).toBe("anthropic");
  });

  it("accepts the header form as well as the path form", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-customer-key",
        "x-lyceum-key": TOKEN,
      },
      body: JSON.stringify(chat("hi")),
    });
    expect(res.status).toBe(200);
  });
});

// ── Token / tenant handling ─────────────────────────────────────────────────

describe("tenant identification", () => {
  it("rejects a request with no token, and explains the fix", async () => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(chat("hi")),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_PROXY_TOKEN");
    expect(body.error.message).toContain("baseURL");
    expect(captured).toHaveLength(0);
  });

  it("rejects an unknown token without contacting the provider", async () => {
    const res = await post("/t/lyc_live_wrong/v1/chat/completions", chat("hi"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNKNOWN_PROXY_TOKEN");
    expect(captured).toHaveLength(0);
  });

  it("refuses unparseable JSON rather than forwarding it ungoverned", async () => {
    const res = await fetch(`${baseUrl}/t/${TOKEN}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-x" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("UNPARSEABLE_BODY");
    // The important part: it did NOT silently skip the breaker and forward.
    expect(captured).toHaveLength(0);
  });

  it("fingerprints keys without storing them, and refuses to hash unsalted", () => {
    const fp = fingerprintKey("Bearer sk-abc123");
    expect(fp).toHaveLength(8);
    expect(fp).not.toContain("sk-");

    delete process.env.LYCEUM_FINGERPRINT_SALT;
    expect(fingerprintKey("Bearer sk-abc123")).toBe("unsalted");
    process.env.LYCEUM_FINGERPRINT_SALT = "test-salt";
  });
});

// ── Containment ─────────────────────────────────────────────────────────────

describe("containment — a blocked request must never reach the provider", () => {
  it("drops a destructive payload with 403 and no upstream call", async () => {
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("run rm -rf / right now"));

    expect(res.status).toBe(403);
    expect(res.headers.get("x-lyceum-decision")).toBe("blocked");
    expect(res.headers.get("x-lyceum-breach")).toBe("RESTRICTED_PAYLOAD");
    expect(captured, "the provider must not have been called").toHaveLength(0);

    const body = await res.json();
    expect(body.error.type).toBe("lyceum_circuit_breaker");
    expect(body.lyceum.halted).toBe(true);
    expect(body.lyceum.retryable).toBe(false);
    // Not recoverable by a human — the request itself is unsafe.
    expect(body.lyceum.humanActionRequired).toBe(false);
  });

  it("reports the evaluation time so the SLA is observable by the client", async () => {
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("DROP TABLE users;"));
    const ms = Number(res.headers.get("x-lyceum-eval-ms"));
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(100);
  });

  it("writes a breach into the evidence graph with the key redacted", async () => {
    await post(`/t/${TOKEN}/v1/chat/completions`, chat("rm -rf / --no-preserve-root"));

    const breach = evidenceWrites.find((w) => w.kind === "breach");
    expect(breach).toBeDefined();
    const serialized = JSON.stringify(breach!.payload);
    expect(serialized).not.toContain("sk-customer-key");
  });

  it("keeps enforcing when the audit store is down (audit outage ≠ open circuit)", async () => {
    evidenceShouldFail = true;
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("mkfs.ext4 /dev/sda1"));
    // Still blocked, still no upstream call, despite the audit write throwing.
    expect(res.status).toBe(403);
    expect(captured).toHaveLength(0);
  });
});

// ── Metering ────────────────────────────────────────────────────────────────

describe("metering", () => {
  it("records real usage from the provider response against the session", async () => {
    await breaker.resetSession(`${TOKEN}:default:${fingerprintKey("Bearer sk-customer-key")}`);

    upstreamResponse = () =>
      new Response(
        JSON.stringify({ usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );

    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("expensive"));
    const sessionId = res.headers.get("x-lyceum-session")!;

    const state = await breaker.snapshot(sessionId);
    // 1M in + 1M out on gpt-4o = $12.50.
    expect(state.spentCents).toBeCloseTo(1250, 0);
  });

  it("reads both OpenAI and Anthropic usage shapes", () => {
    expect(readUsage({ usage: { prompt_tokens: 3, completion_tokens: 4 } })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
    });
    expect(readUsage({ usage: { input_tokens: 5, output_tokens: 6 } })).toEqual({
      inputTokens: 5,
      outputTokens: 6,
    });
    expect(readUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("separates sessions by the x-lyceum-session header", async () => {
    const a = await post(`/t/${TOKEN}/v1/chat/completions`, chat("a"), {
      "x-lyceum-session": "run-a",
    });
    const b = await post(`/t/${TOKEN}/v1/chat/completions`, chat("b"), {
      "x-lyceum-session": "run-b",
    });
    expect(a.headers.get("x-lyceum-session")).not.toBe(b.headers.get("x-lyceum-session"));
  });

  it("passes a streamed response through and still meters it", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"he"}}]}',
      'data: {"choices":[{"delta":{"content":"llo"}}]}',
      'data: {"usage":{"prompt_tokens":1000000,"completion_tokens":0}}',
      "data: [DONE]",
      "",
    ].join("\n\n");

    upstreamResponse = () =>
      new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });

    await breaker.resetSession(`${TOKEN}:stream`);
    const res = await post(`/t/${TOKEN}/v1/chat/completions`, chat("stream me", { stream: true }), {
      "x-lyceum-session": "stream",
    });

    // The client gets the stream unmodified.
    expect(await res.text()).toBe(sse);

    const state = await breaker.snapshot(`${TOKEN}:stream`);
    // 1M input tokens on gpt-4o = 250 cents.
    expect(state.spentCents).toBeCloseTo(250, 0);
  });
});
