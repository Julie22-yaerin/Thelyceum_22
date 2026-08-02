/**
 * /api/license/enter — the landing-page front door for a customer who just
 * paid.
 *
 * These tests drive the REAL Hono app (createApp) against a temp SQLite DB,
 * not a mocked route. That means the session middleware, the mirror lookup,
 * the owner resolution and the usage payload all run for real. The one thing
 * that is a stub is Lemon Squeezy itself: LYCEUM_DEV_MODE=1 makes
 * validateWithLemonSqueezy accept any key without a network call, which is
 * exactly the mode a trial/demo server runs in.
 *
 * Why dynamic import: index.js and lemonsqueezy.js read env at module load
 * (JWT_SECRET, DEV_MODE). ESM hoists static imports above any code, so env
 * must be set before the import — dynamic import in beforeAll is the only
 * reliable way to order that. Env is cleaned up in afterAll because vitest
 * runs this package's tests in a single shared process.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { openDb, type DbHandle, type SubscriptionRow } from "../src/db.js";
import { signup } from "../src/auth.js";
import { registerInstall } from "../src/devices.js";
import type { ActivateInput } from "../src/lemonsqueezy.js";

const SECRET = "test-secret-for-license-enter";

let dir: string;
let db: DbHandle;
let app: Hono;
/** activateSubscription, loaded dynamically after env is set (see header). */
let activateSubscription: (db: DbHandle, input: ActivateInput) => SubscriptionRow;

async function enter(licenseKey: string, sessionToken?: string): Promise<Response> {
  return await app.request("/api/license/enter", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({ licenseKey }),
  });
}

/** Mirror a recognisable dev key onto an account, as /dev/activate would. */
function mirrorDevKey(userId: string, key: string): void {
  activateSubscription(db, {
    userId,
    plan: "solo",
    billing: "monthly",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    licenseKey: key,
    autoRenew: 1,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lyceum-enter-test-"));
  db = openDb(join(dir, "test.db"));
  process.env.LYCEUM_DEV_MODE = "1";
  process.env.LYCEUM_JWT_SECRET = SECRET;
  process.env.LYCEUM_NO_SERVE = "1";
  const { createApp } = await import("../src/index.js");
  const ls = await import("../src/lemonsqueezy.js");
  app = createApp(db);
  activateSubscription = ls.activateSubscription;
});

afterAll(() => {
  delete process.env.LYCEUM_DEV_MODE;
  delete process.env.LYCEUM_JWT_SECRET;
  delete process.env.LYCEUM_NO_SERVE;
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/license/enter with a mirrored dev key", () => {
  it("returns route=setup when nothing is installed yet", async () => {
    const { user } = signup(db, SECRET, { email: "setup@corp.io", password: "password-123" });
    mirrorDevKey(user.id, "LYCEUM-DEV-SETUP01");

    const res = await enter("LYCEUM-DEV-SETUP01");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      needsSetup?: boolean;
      route?: string;
      installs?: unknown[];
      sessionToken?: string;
      user?: { id: string; email: string };
    };
    expect(body.ok).toBe(true);
    expect(body.needsSetup).toBe(true);
    expect(body.route).toBe("setup");
    expect(body.installs).toEqual([]);
    // The key is the credential: entry signs the customer in even without a
    // prior session.
    expect(body.sessionToken).toBeTruthy();
    expect(body.user?.email).toBe("setup@corp.io");
  });

  it("returns route=dashboard once an install exists", async () => {
    const { user } = signup(db, SECRET, { email: "dash@corp.io", password: "password-123" });
    mirrorDevKey(user.id, "LYCEUM-DEV-DASH01");
    registerInstall(db, { userId: user.id, hostType: "claude-code", deviceId: "dev-1" });

    const res = await enter("LYCEUM-DEV-DASH01");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needsSetup?: boolean; route?: string; installs?: unknown[] };
    expect(body.needsSetup).toBe(false);
    expect(body.route).toBe("dashboard");
    expect(body.installs).toHaveLength(1);
  });

  it("refuses a different account's session with 409 already_claimed", async () => {
    const owner = signup(db, SECRET, { email: "owner@corp.io", password: "password-123" });
    mirrorDevKey(owner.user.id, "LYCEUM-DEV-OWNER1");
    const intruder = signup(db, SECRET, { email: "intruder@corp.io", password: "password-123" });

    const res = await enter("LYCEUM-DEV-OWNER1", intruder.sessionToken);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("already_claimed");
  });

  it("lets the key's own owner enter with their session — one key, one account, no false 409", async () => {
    const owner = signup(db, SECRET, { email: "owner2@corp.io", password: "password-123" });
    mirrorDevKey(owner.user.id, "LYCEUM-DEV-OWNER2");

    const res = await enter("LYCEUM-DEV-OWNER2", owner.sessionToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; user?: { id: string } };
    expect(body.ok).toBe(true);
    expect(body.user?.id).toBe(owner.user.id);
  });
});

describe("/api/license/enter — the un-attributable branch", () => {
  it("returns needsAccount when the key matches no account", async () => {
    // A key that exists nowhere: not in the mirror. Dev mode validates it
    // (stub), no email comes back, no session is attached — the only honest
    // answer is needsAccount.
    const res = await enter("LYCEUM-TRIAL-1111-2222-3333");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; needsAccount?: boolean; email?: string | null };
    expect(body.ok).toBe(true);
    expect(body.needsAccount).toBe(true);
    expect(body.email).toBeNull();
  });

  it("rejects a too-short key with 400 invalid_input", async () => {
    const res = await enter("short");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_input");
  });
});
