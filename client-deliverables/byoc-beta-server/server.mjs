#!/usr/bin/env node
/**
 * The Lyceum — BYOC beta license server.
 *
 * Self-hosted, standalone: run this on your own infrastructure so beta
 * usage validation never leaves your network. Zero npm dependencies —
 * everything here is a Node.js builtin (node:sqlite needs Node >= 22.5.0),
 * so `node server.mjs` is the entire install step.
 *
 * Speaks the exact same two-route contract as the hosted Lyceum server
 * (POST /api/admin/beta/tokens to mint, POST /api/beta/check to validate),
 * so brake/redteam/thrift's dist builds work completely unmodified against
 * this — just point LYCEUM_SERVER_URL at wherever you run it.
 *
 * ── Config (env vars) ────────────────────────────────────────────────────
 *   BETA_ADMIN_KEY       required to mint tokens. Generate your own, e.g.
 *                        `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
 *   BETA_SIGNING_SECRET  signs issued keys. Auto-generated and printed once
 *                        on first run if not set — save it, restarting
 *                        without it invalidates every key already handed out.
 *   PORT                 default 8787
 *   DB_PATH              default ./beta-server.db
 */

import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? "./beta-server.db";
const ADMIN_KEY = process.env.BETA_ADMIN_KEY;
const SIGNING_SECRET = process.env.BETA_SIGNING_SECRET ?? randomBytes(32).toString("hex");
const LICENSE_PREFIX = "LYCEUM-BETA-";

if (!ADMIN_KEY) {
  console.error("BETA_ADMIN_KEY is not set — minting is disabled until you set one and restart.");
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"');
}
if (!process.env.BETA_SIGNING_SECRET) {
  console.log(`No BETA_SIGNING_SECRET set — generated one for this run. Save it or every`);
  console.log(`key you mint stops validating on restart:\n\n  BETA_SIGNING_SECRET=${SIGNING_SECRET}\n`);
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS beta_licenses (
    id           TEXT PRIMARY KEY,
    label        TEXT NOT NULL,
    daily_limit  INTEGER NOT NULL,
    issued_at    INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    revoked_at   INTEGER
  );
  CREATE TABLE IF NOT EXISTS beta_usage (
    license_id  TEXT NOT NULL,
    day         TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (license_id, day)
  );
`);

function sign(licenseId) {
  return createHmac("sha256", SIGNING_SECRET).update(licenseId).digest("hex");
}

function timingSafeStringEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function mint({ label, days = 7, dailyLimit = 10 }) {
  if (!label || !String(label).trim()) throw { status: 400, code: "invalid_input", message: "A label is required." };
  if (!(days > 0) || !(dailyLimit > 0)) throw { status: 400, code: "invalid_input", message: "days and dailyLimit must be positive." };

  const licenseId = `beta_${randomUUID()}`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + days * 24 * 60 * 60 * 1000;

  db.prepare(
    `INSERT INTO beta_licenses (id, label, daily_limit, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(licenseId, String(label).trim(), dailyLimit, issuedAt, expiresAt);

  const licenseKey = `${LICENSE_PREFIX}${licenseId}.${sign(licenseId)}`;
  return { licenseKey, licenseId, label: String(label).trim(), dailyLimit, expiresAt };
}

function check(licenseKey) {
  const raw = licenseKey.startsWith(LICENSE_PREFIX) ? licenseKey.slice(LICENSE_PREFIX.length) : licenseKey;
  const [licenseId, signature] = raw.split(".");
  if (!licenseId || !signature || !timingSafeStringEqual(signature, sign(licenseId))) {
    throw { status: 401, code: "invalid_token", message: "That beta license key isn't valid." };
  }

  const license = db.prepare("SELECT * FROM beta_licenses WHERE id = ?").get(licenseId);
  if (!license) throw { status: 401, code: "invalid_token", message: "That beta license key isn't valid." };
  if (license.revoked_at) throw { status: 403, code: "revoked", message: "This beta license has been revoked." };

  const now = Date.now();
  if (now >= license.expires_at) {
    throw { status: 403, code: "expired", message: `This beta trial expired on ${utcDay(license.expires_at)}.` };
  }

  const day = utcDay(now);

  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO beta_usage (license_id, day, count) VALUES (?, ?, 0) ON CONFLICT (license_id, day) DO NOTHING`).run(
      license.id,
      day
    );
    const row = db.prepare("SELECT count FROM beta_usage WHERE license_id = ? AND day = ?").get(license.id, day);
    if (row.count >= license.daily_limit) {
      db.exec("COMMIT");
      throw {
        status: 429,
        code: "limit_reached",
        message: `Daily limit reached (${license.daily_limit}/${license.daily_limit} uses today). Resets at 00:00 UTC.`,
      };
    }
    db.prepare("UPDATE beta_usage SET count = count + 1 WHERE license_id = ? AND day = ?").run(license.id, day);
    db.exec("COMMIT");
    return {
      ok: true,
      usesRemainingToday: license.daily_limit - (row.count + 1),
      daysRemaining: Math.max(0, (license.expires_at - now) / (24 * 60 * 60 * 1000)),
    };
  } catch (err) {
    if (err.code !== "limit_reached") db.exec("ROLLBACK");
    throw err;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/admin/beta/tokens") {
      const auth = req.headers["authorization"] ?? "";
      const presented = auth.match(/^Bearer (.+)$/)?.[1];
      if (!ADMIN_KEY || !presented || !timingSafeStringEqual(presented, ADMIN_KEY)) {
        return send(res, 401, { error: "unauthorized" });
      }
      const body = await readJsonBody(req).catch(() => null);
      if (!body) return send(res, 400, { error: "invalid_input" });
      try {
        return send(res, 200, { ok: true, ...mint(body) });
      } catch (err) {
        return send(res, err.status ?? 400, { error: err.code ?? "error", message: err.message });
      }
    }

    if (req.method === "POST" && req.url === "/api/beta/check") {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || typeof body.licenseKey !== "string") return send(res, 400, { error: "invalid_input" });
      try {
        return send(res, 200, check(body.licenseKey));
      } catch (err) {
        return send(res, err.status ?? 401, { ok: false, error: err.code ?? "error", message: err.message });
      }
    }

    send(res, 404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: "internal_error" });
  }
});

server.listen(PORT, () => {
  console.log(`Lyceum BYOC beta server listening on :${PORT}`);
  console.log(`  Mint:  curl -X POST http://localhost:${PORT}/api/admin/beta/tokens -H "Authorization: Bearer $BETA_ADMIN_KEY" -H "content-type: application/json" -d '{"label":"eng-eval","days":7,"dailyLimit":10}'`);
  console.log(`  Point brake/redteam/thrift at it: export LYCEUM_SERVER_URL=http://localhost:${PORT}`);
});
