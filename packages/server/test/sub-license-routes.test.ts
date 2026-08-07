/**
 * /api/admin/sub-licenses/* and /api/license-pool/* — driven through the
 * real Hono app, not the sub-license.ts module directly. Same reasoning as
 * beta-routes.test.ts: /api/license-pool/validate and /enter are called by
 * a CLI or the redeem page with no session, so they must be on the public
 * allowlist in the global /api/* auth middleware or they 401 before ever
 * reaching the handler — a bug the unit tests alone can't see.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { openDb, type DbHandle } from "../src/db.js";

const ADMIN_KEY = "LYC-ADMIN-sub-license-routes-test";

let dir: string;
let db: DbHandle;
let app: Hono;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-sub-license-routes-test-"));
  db = openDb(join(dir, "test.db"));
  process.env.LYCEUM_JWT_SECRET = "test-secret-for-sub-license-routes";
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

async function seed(): Promise<Response> {
  return await app.request("/api/admin/sub-licenses/seed", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_KEY}` },
    body: JSON.stringify({}),
  });
}

async function setStatus(id: string, body: Record<string, unknown>): Promise<Response> {
  return await app.request(`/api/admin/sub-licenses/${id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_KEY}` },
    body: JSON.stringify(body),
  });
}

async function validate(licenseKey: string): Promise<Response> {
  return await app.request("/api/license-pool/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey }),
  });
}

async function enter(licenseKey: string): Promise<Response> {
  return await app.request("/api/license-pool/enter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey }),
  });
}

describe("POST /api/admin/sub-licenses/seed", () => {
  it("refuses without admin key", async () => {
    const res = await app.request("/api/admin/sub-licenses/seed", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("seeds 10 licenses for a valid admin", async () => {
    const res = await seed();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.licenses).toHaveLength(10);
  });
});

describe("POST /api/admin/sub-licenses/:id/status", () => {
  it("marks a slot taken", async () => {
    const { licenses } = await (await seed()).json();
    const res = await setStatus(licenses[0].id, { status: "taken", label: "test-customer" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.license.status).toBe("taken");
    expect(json.license.label).toBe("test-customer");
  });
});

describe("POST /api/license-pool/validate and /enter", () => {
  it("both are reachable with no Authorization header at all", async () => {
    const { licenses } = await (await seed()).json();
    await setStatus(licenses[1].id, { status: "taken" });

    const v = await validate(licenses[1].license_key);
    expect(v.status).not.toBe(401);
    expect((await v.json()).ok).toBe(true);

    const e = await enter(licenses[1].license_key);
    expect(e.status).not.toBe(401);
    const ej = await e.json();
    expect(ej.ok).toBe(true);
  });

  it("/enter does NOT mark check-in — only a real CLI call to /validate does", async () => {
    const { licenses } = await (await seed()).json();
    await setStatus(licenses[3].id, { status: "taken" });

    const afterEnter = await (await enter(licenses[3].license_key)).json();
    expect(afterEnter.firstCheckinAt).toBeNull();

    const afterValidate = await (await validate(licenses[3].license_key)).json();
    expect(afterValidate.firstCheckinAt).not.toBeNull();
  });

  it("check-in is idempotent — a second CLI validate doesn't move the timestamp", async () => {
    const { licenses } = await (await seed()).json();
    await setStatus(licenses[4].id, { status: "taken" });

    const first = await (await validate(licenses[4].license_key)).json();
    const second = await (await validate(licenses[4].license_key)).json();
    expect(second.firstCheckinAt).toBe(first.firstCheckinAt);
  });

  it("rejects a not-yet-taken code with 403, not a session error", async () => {
    const { licenses } = await (await seed()).json();
    const res = await validate(licenses[2].license_key);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("not_taken");
  });

  it("rejects a garbage key with 401, not a 500", async () => {
    const res = await validate("garbage");
    expect(res.status).toBe(401);
  });
});

async function cancel(licenseKey: string): Promise<Response> {
  return await app.request("/api/license-pool/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey }),
  });
}

async function upgrade(licenseKey: string, months: number): Promise<Response> {
  return await app.request("/api/license-pool/upgrade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey, months }),
  });
}

describe("POST /api/license-pool/cancel", () => {
  it("is reachable with no auth and returns the slot to the pool", async () => {
    const { licenses } = await (await seed()).json();
    await setStatus(licenses[5].id, { status: "taken", label: "someone" });

    const res = await cancel(licenses[5].license_key);
    expect(res.status).not.toBe(401);
    expect((await res.json()).ok).toBe(true);

    // The same code must no longer validate — it's back in the pool as not_taken.
    const v = await validate(licenses[5].license_key);
    expect(v.status).toBe(403);
  });
});

describe("POST /api/license-pool/upgrade", () => {
  it("extends expiry by the given number of months from the current expiry", async () => {
    const { licenses } = await (await seed()).json();
    const setRes = await setStatus(licenses[6].id, { status: "taken" });
    const before = (await setRes.json()).license.expires_at;

    const res = await upgrade(licenses[6].license_key, 3);
    expect(res.status).not.toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.expiresAt - before).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
    expect(json.expiresAt - before).toBeLessThan(91 * 24 * 60 * 60 * 1000);
  });

  it("supports a 12-month (yearly) upgrade", async () => {
    const { licenses } = await (await seed()).json();
    const setRes = await setStatus(licenses[7].id, { status: "taken" });
    const before = (await setRes.json()).license.expires_at;

    const json = await (await upgrade(licenses[7].license_key, 12)).json();
    expect(json.expiresAt - before).toBeGreaterThan(359 * 24 * 60 * 60 * 1000);
  });

  it("rejects upgrading a code that was never taken", async () => {
    const { licenses } = await (await seed()).json();
    const res = await upgrade(licenses[8].license_key, 1);
    expect(res.status).toBe(403);
  });

  it("rejects a non-positive months value", async () => {
    const { licenses } = await (await seed()).json();
    await setStatus(licenses[9].id, { status: "taken" });
    const res = await upgrade(licenses[9].license_key, 0);
    expect(res.status).toBe(400);
  });
});
