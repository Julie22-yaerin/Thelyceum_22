# The Lyceum

**Circuit breakers for AI.** Two tools, done narrowly, that stop an agent
before it costs you — one stops a dangerous *action*, the other stops a
one-sided *conclusion*.

```
packages/
  brake/     stops the action    — CLI + MCP server + skill
  redteam/   stops the argument  — CLI + MCP server + skill
  server/    licensing, waitlist, admin console, marketing site
```

---

## The two breakers

| | [`brake`](packages/brake) | [`redteam`](packages/redteam) |
|---|---|---|
| Stops | A dangerous **action** | A one-sided **conclusion** |
| Catches | Data exfiltration, infrastructure attacks, credential access, destructive ops, money movement, impersonation | Overconfidence, unsupported claims, confirmation bias, false dichotomies, missing trade-offs, straw men, and three more |
| Throughput | ~1,370,000 scans/sec | ~494,000 challenges/sec |
| Per call | p50 0.73µs · p99 0.93µs | p50 1.96µs · p99 18.4µs |
| Network on the hot path | none | none |

Both are always-on: the model calls them itself, with no slash command and no
asking. Both are covered by one subscription.

Those figures are measured on a single core after JIT warm-up, and each package
has a `test/throughput.test.ts` that fails the build if it regresses — a
performance claim nobody re-checks is a claim that quietly rots.

---

## Running it locally

```bash
npm install
npm run build
npm test
```

Then start the server:

```bash
LYCEUM_DEV_MODE=1 \
LYCEUM_ADMIN_KEYS="pick-a-long-random-string" \
npm run server
```

| | |
|---|---|
| Site | http://localhost:3000/web/ |
| Showroom (plans, setup guides) | http://localhost:3000/web/showroom |
| Admin console | http://localhost:3000/web/admin |

`LYCEUM_DEV_MODE=1` bypasses payment so subscriptions activate without one.
Never set it in production — the server says so loudly at boot.

---

## Configuration

| Variable | Purpose |
|---|---|
| `LYCEUM_LAUNCH_MODE` | `waitlist` (default) or `open`. Pre-launch, checkout is refused server-side and the site shows the waitlist. |
| `LYCEUM_ADMIN_KEYS` | Comma-separated admin license keys. **Never read from the database** — see [LICENSING.md](LICENSING.md). |
| `LYCEUM_JWT_SECRET` | Signs sessions and license tokens. |
| `LYCEUM_DB_PATH` | SQLite file. Defaults to `packages/server/data/lyceum.db`. |
| `LYCEUM_PUBLIC_URL` | Public origin, used for checkout redirects and CORS. |
| `LEMONSQUEEZY_API_KEY` | Creating checkouts. |
| `LEMONSQUEEZY_STORE_ID` | Your store. |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | HMAC secret. Without it every webhook is refused — which is the safe default, since that endpoint grants subscriptions. |
| `LS_VARIANT_{SOLO,TEAM,SCALE}_{MONTHLY,ANNUAL}` | Variant ids. Missing ones are a **startup failure**, not a 500 at checkout — a customer who clicks buy and gets an error is a lost sale you never hear about. |
| `LS_VARIANT_WAITLIST_DEPOSIT` | Variant for the refundable waitlist deposit. |

---

## How money and access work

1. Someone **applies to the waitlist** — name, organisation, work email, phone.
   Consumer mail domains are refused with a route to take instead.
2. They pay a **refundable $10 deposit**. It credits against their first
   invoice. It exists so the list reflects intent, not curiosity.
3. An operator **approves them by hand** in the admin console. Nothing is
   automatic.
4. On launch they check out through **Lemon Squeezy**, which issues a license
   key and emails it. Lemon Squeezy is the merchant of record, so VAT and sales
   tax are handled rather than left to you.
5. The webhook mirrors that key locally, so every later check is a local
   lookup — an outage on their side must not stop a paying customer's agents.

---

## Plans

| | Connections | Monthly |
|---|---|---|
| Solo | 5 | $99 |
| Team | 10 | $299 |
| Scale | 15 | $799 |
| Enterprise | unlimited | by contact |

A connection is one install of one tool on one machine. Enterprise is
deliberately not a checkout tier — past 15 machines you need a conversation
about scale and procurement, and a number on a button there is either a lowball
or a wrong guess.

---

## Licensing

Currently MIT. If you intend to sell this as closed software, read
**[LICENSING.md](LICENSING.md)** first — it sets out what code protection can
and cannot achieve, why moving the detection server-side would destroy the
performance claim above, and what to do instead.

The short version: you cannot stop a determined developer copying code that
runs on their machine. You can make copying not worth it, and that is a
different and solvable problem.
