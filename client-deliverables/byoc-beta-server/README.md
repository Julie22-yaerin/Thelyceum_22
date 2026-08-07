# The Lyceum — BYOC beta license server

Self-hosted trial gate for the beta package. Run this on your own
infrastructure and beta-usage validation never leaves your network — no
call to any Lyceum-operated server.

Zero npm dependencies. `server.mjs` uses only Node.js builtins (`node:http`,
`node:sqlite`), so there is no install step. Requires **Node.js >= 22.5.0**.

## 1. Run it

```bash
export BETA_ADMIN_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
node server.mjs
```

On first run with no `BETA_SIGNING_SECRET` set, the server generates one and
prints it once — **save it**. Every license key it mints is signed with this
secret; losing it (or restarting without setting it explicitly) invalidates
every key already handed out.

```
No BETA_SIGNING_SECRET set — generated one for this run. Save it or every
key you mint stops validating on restart:

  BETA_SIGNING_SECRET=<...>
```

Env vars:

| Var | Default | |
|---|---|---|
| `BETA_ADMIN_KEY` | *(required to mint)* | Bearer token for the mint endpoint. Generate your own. |
| `BETA_SIGNING_SECRET` | auto-generated | Signs issued keys. Set this explicitly once you have one, so restarts don't invalidate outstanding keys. |
| `PORT` | `8787` | |
| `DB_PATH` | `./beta-server.db` | SQLite file — the trial state (licenses + daily usage counts) lives here. |

## 2. Mint a key

```bash
curl -X POST http://localhost:8787/api/admin/beta/tokens \
  -H "Authorization: Bearer $BETA_ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '{"label": "openai-eng-trial", "days": 7, "dailyLimit": 10}'
```

Returns `{ "ok": true, "licenseKey": "LYCEUM-BETA-...", "expiresAt": ... }`.
`days` and `dailyLimit` both default to 7 / 10 if omitted.

## 3. Give the evaluator the key

They install it once, on their own machine:

```bash
node beta-activate.mjs LYCEUM-BETA-...
```

(`beta-activate.mjs` ships in the main beta package, alongside the `thrift`/
`brake`/`redteam` tarballs — see the top-level `QUICKSTART-beta-test.md`.)

Then, **before** using the tools, they point at your server instead of the
default Lyceum-hosted one:

```bash
export LYCEUM_SERVER_URL=http://your-server-host:8787
```

That's the only difference from the hosted-server flow — the `brake`/
`redteam`/`thrift` binaries themselves are unmodified; they just check in
with whichever server `LYCEUM_SERVER_URL` points at.

## 4. Revoke or extend a trial early

There's no route for this yet — it's a direct SQLite edit on `beta-server.db`:

```bash
sqlite3 beta-server.db "UPDATE beta_licenses SET revoked_at = strftime('%s','now')*1000 WHERE label = 'openai-eng-trial';"
sqlite3 beta-server.db "UPDATE beta_licenses SET expires_at = expires_at + 7*24*60*60*1000 WHERE label = 'openai-eng-trial';"
```

## What this is not

This is the trial-gating mechanism only — expiry and a daily call cap. It is
not the full Lyceum backend (no billing, no waitlist, no accounts): that
separation is deliberate, so handing this over for self-hosting doesn't also
hand over commercial/billing internals that have nothing to do with running
a beta.
