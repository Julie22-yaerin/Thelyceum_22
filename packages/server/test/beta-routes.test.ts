/**
 * /api/beta/check and /api/admin/beta/tokens — driven through the real Hono
 * app (createApp), not the beta.ts module directly.
 *
 * The regression this guards: /api/beta/check is called by a CLI on someone
 * else's machine with nothing but the license key — no session, no
 * Authorization header. The global `/api/*` auth middleware defaults to
 * requiring a Bearer session token, so a route meant to be public has to be
 * explicitly listed as one or it 401s as "unauthenticated" before ever
 * reaching the handler. beta.test.ts alone can't catch that class of bug
 * because it calls checkBetaUsage() directly, skipping the middleware
 * entirely — this file exists specifically to cover the wiring.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { openDb, type DbHandle } from "../src/db.js";

const SECRET = "test-secret-for-beta-routes";
const ADMIN_KEY = "LYC-ADMIN-beta-routes-test";

let dir: string;
let db: DbHandle;
let app: Hono;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-beta-routes-test-"));
  db = openDb(join(dir, "test.db"));
  process.env.LYCEUM_JWT_SECRET = SECRET;
  process.env.LYCEUM_ADMIN_KEYS = ADMIN_KEY;
  process.env.LYCEUM_NO_SERVE = "1";
  const { createApp } = await import("../src/index.js");
  app = createApp(db);
});

afterAll(() => {
  delete process.env.LYCEUM_JWT_SECRET;
  delete process.env.LYCEUM_ADMIN_KEYS;
  delete process.env.LYCEUM_NO_SERVE;
  rmSync(dir, { recursive: true, force: true });
});

async function mint(body: Record<string, unknown>): Promise<Response> {
  return await app.request("/api/admin/beta/tokens", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_KEY}` },
    body: JSON.stringify(body),
  });
}

async function check(licenseKey: string): Promise<Response> {
  // Deliberately no Authorization header — this is the whole point of the test.
  return await app.request("/api/beta/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey }),
  });
}

describe("POST /api/admin/beta/tokens", () => {
  it("refuses without a valid admin key", async () => {
    const res = await app.request("/api/admin/beta/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("mints a key for a valid admin request", async () => {
    const res = await mint({ label: "openai-eng-trial", days: 7, dailyLimit: 10 });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.licenseKey).toMatch(/^LYCEUM-BETA-/);
    expect(json.dailyLimit).toBe(10);
  });
});

describe("POST /api/beta/check", () => {
  it("is reachable with no Authorization header at all", async () => {
    const minted = await (await mint({ label: "no-auth-check" })).json();
    const res = await check(minted.licenseKey);
    expect(res.status).not.toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.usesRemainingToday).toBe(9);
  });

  it("returns 429 once the daily limit is exceeded", async () => {
    const minted = await (await mint({ label: "limit-check", dailyLimit: 2 })).json();
    await check(minted.licenseKey);
    await check(minted.licenseKey);
    const res = await check(minted.licenseKey);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("limit_reached");
  });

  it("rejects an invalid key with 401, not a 500", async () => {
    const res = await check("garbage-not-a-real-key");
    expect(res.status).toBe(401);
  });
});
