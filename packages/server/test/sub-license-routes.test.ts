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
    expect(ej.redirectTo).toBe("/web/showroom#guides");
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
