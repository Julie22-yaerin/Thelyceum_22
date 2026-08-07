# The Lyceum — 1-month pre-release trial plan

**Status:** proposal · **Duration:** 30 days, ending with a go/no-go on flipping `LAUNCH_MODE=open` · **Scope:** cloud track + local track, one cohort, one license.

This document is the plan for the month before release. It names the existing
machinery it reuses — the waitlist, the deposit, license keys, dev-mode
activation, the cloud benchmark workflow — so "trial" is a configuration
change on infra we already run, not a new product to build.

---

## 1. What the trial is for

The month has three jobs, in priority order:

1. **Prove the tools install and run on real machines** — macOS, Windows,
   Linux; Claude Desktop, Claude Code, ChatGPT, CI. An install that fails on
   one OS on day one of general availability is a bad first impression we
   never recover.
2. **Get cloud numbers that are measured, not promised** — the latency and
   throughput of brake / redteam / thrift on cloud runners (x64 + arm64), not
   just the local machine the README was written on.
3. **Learn how the guided setup performs with real operators** — where they
   get stuck, which guides are wrong, what "15 minutes" actually means.

Anything the trial does not teach us before release will be learned from
paying customers — the expensive classroom.

---

## 2. Cohort: where trial users come from

Reuse the existing waitlist pipeline (`packages/server/src/waitlist.ts`).
The $50 deposit already filters for intent; the trial is the payoff for the
people who paid it.

| Stage | Who | Gate |
|---|---|---|
| Week 1 | 5 companies, waitlist status `paid` only | Hand-picked: at least one macOS and one Linux shop |
| Week 2 | +15, status `paid` or `approved` | Mix of Windows shops in by end of week 2 |
| Week 3 | +30 total cohort cap | Anyone `paid` — the deposit is the filter |
| Week 4 | No new entrants; harden & close | Freeze cohort for measurement |

Cohort cap: **30 companies, ~5 connections each**. That is small enough to
read every ticket, large enough to hit all three OSes and all four hosts.

---

## 3. Licensing during the trial

No new license machinery. Two existing paths, picked per track:

**Local track — dev-mode-style activation with an expiry.**
The server already has `/dev/activate` (`LYCEUM_DEV_MODE=1`) which writes a
`LYCEUM-DEV-…` license key with `duration_ms`. For the trial we reuse the same
code path but behind a trial token, so:

- each cohort company gets one trial key, active for **30 days** (not the
  normal billing cycle);
- the subscription row is a real row in `lyceum.db` — so
  `lockIfExpired` (already running every 60s in `packages/server/src/index.ts`)
  locks trial keys exactly like paid ones, on the same timer;
- connection limits (`solo`/`team`/`scale`) are enforced as usual — a trial
  company on 5 connections sees the same 402 as a paying one. The trial is a
  full product, not a demo.

**Status: implemented** (`packages/server/src/trial.ts`). The trial is a real
subscription row written by the same `activateSubscription` path, with
`auto_renew = 0` so `lockIfExpired` locks it on day 30 — no new timer.

- Admin mints a token: `POST /api/admin/trial/tokens` `{ email, plan? }` —
  refused unless the waitlist application is `paid` or `approved` (the
  cohort gate), audit-logged as `trial.mint`.
- Member redeems it: `POST /api/trial/activate` `{ token }` (signed-in
  session) — token is bound to the email it was minted for, so it can't be
  pasted into a different account; one trial per account, ever.
- License key is `LYCEUM-TRIAL-…` (deliberately recognisable, like
  `LYCEUM-DEV-`); expiry = mint-redeem + 30 days.
- Dashboard: the showroom's account page has a *Start your 30-day trial*
  box that appears when there's no active subscription.

**Cloud track — the license is real, the machine is ours.**
Cloud measurements do not run on the customer's laptop; they run on the CI
workflow we already ship (`.github/workflows/throughput.yml`, ubuntu x64 +
arm64) against the same corpora as the local benchmarks. Trial companies get
read access to the benchmark artifact (`benchmark-results.json`) so the
"cloud" number they see is the same artifact CI produced, not a screenshot.

**No free rides:** trial keys carry the same `LYCEUM-DEV-` prefix discipline —
recognisable, never mistakable for a paid key. On release, every trial key
either converts (moves to a real Lemon Squeezy variant via the existing
checkout) or dies on the 30-day timer.

---

## 4. Cloud track — measured on cloud, end to end

What already exists: the throughput workflow builds all three packages and
runs `scripts/benchmark.mjs` on ubuntu (x64 + arm64), writing
`benchmark-results.json`, failing CI on floor breach *or* token-guard edge
case. The trial month adds three things on top:

| Add | Why | Where | Status |
|---|---|---|---|
| **Latency, not just throughput** | calls/sec hides p50/p95; a brake that is fast on aggregate but slow at the tail is exactly the miss we claim to report | **implemented** — `benchmark.mjs` latency pass times each call individually (default 20k samples, `BENCH_LATENCY_SAMPLES`), reports p50/p95/p99/max, and gates p95: brake ≤ 1000ms (the TRIAL_PLAN release gate), redteam ≤ 1000ms (pathology gate — in-process calls should never take a second), thrift ≤ 10ms (its own ms-level gate — measured p95 ≈ 155µs, so a shared 1000ms gate would sit ~6400× away and could never fire; env `BENCH_LATENCY_FLOOR_THRIFT_MS`) | ✅ `scripts/benchmark.mjs` |
| **Per-OS install smoke** | the workflow currently builds & benchmarks; it never installs into a host | **implemented** — job `install-smoke` in `.github/workflows/throughput.yml` runs `scripts/install-smoke.mjs` on ubuntu / macos / windows: `npm pack` → `npm i -g` → `--version`, `scan`/`challenge`/`measure` smoke against the installed artifact, exit-code asserts | ✅ `scripts/install-smoke.mjs` |
| **MCP handshake test** | an MCP server that starts but never speaks to a host is untested until a human finds out | **implemented** — job `mcp-handshake` (x64 + arm64) runs `scripts/mcp-smoke.mjs`: spawns each `dist/mcp.js` on stdio, real `initialize` via the SDK client, asserts `tools/list` advertises every expected tool | ✅ `scripts/mcp-smoke.mjs` |
| **MCP wire latency pass** | the in-process latency pass cannot see a serialization/pipe regression — only the real stdio round-trip can | **implemented** — `scripts/mcp-smoke.mjs --json` measures the true wire path (fresh spawn+initialize per sample, tools/list round-trips on one connection), p50/p95/p99/max per server; `benchmark.mjs` spawns it and merges into `benchmark-results.json`, gated at init p95 ≤ 2000ms / list p95 ≤ 250ms (env `BENCH_MCP_INIT_GATE_MS` / `BENCH_MCP_LIST_GATE_MS`) | ✅ `scripts/benchmark.mjs` + `scripts/mcp-smoke.mjs` |
| **Cross-arch latency drift check** | one arch can pass its gate while the other hides a real tail — and neither is checked against the machine the README numbers came from | **implemented** — job `latency-drift` downloads both arch artifacts and runs `scripts/compare-benchmarks.mjs`: warns (non-blocking `::warning::`) when p95 drifts > 2× between x64 and arm64, or when a cloud runner is > 2× slower than the local dev baseline (pass your laptop's `benchmark-results.json` in as `local=…`); default 2× threshold via `BENCH_DRIFT_WARN_X` | ✅ `scripts/compare-benchmarks.mjs` |

Cloud SLA gate for release: brake p95 ≤ 1000ms on both architectures, thrift
dedupe hold (JWT 0% saved, image/json guard) on both, MCP wire latency under
gate (init ≤ 2000ms / tools-list ≤ 250ms p95), all three install smokes green
on all three OSes. If a gate fails, release slips — that is the whole point
of measuring before launch. Cross-arch p95 drift > 2× (or a cloud runner
slower than the dev baseline by > 2×) is a warning, not a gate — it flags
hardware/regression surprises the per-arch gates would each miss.

---

## 5. Local track — the guided setup under fire

Each cohort company gets the existing gated guides (`packages/server/src/guides.ts`)
— free first step, rest unlocks with the trial license — and is asked to do
one specific thing per week:

- **Week 1–2: install on every machine they run agents on** (macOS, Windows,
  Linux, CI runner). The guide's "15 minutes" is measured against reality:
  every step that confuses them is a ticket, and every ticket is a guide fix.
- **Week 2–3: run the real loop** — brake engaged for real (track a PID,
  `brake engage --dry-run` then real), redteam blocking a Write/Edit in
  Claude Code, thrift `measure --passes 5` on their own repo.
- **Week 4: 30-day report** — each company sends back: did the brake ever
  miss its SLA, did redteam block something real, what did thrift save on
  their files (lossless vs lossy split).

What we measure on the local track (from the audit logs the tools already
write, via `brake status` / `redteam status` / `thrift report`):

- **install success rate per OS** — the single most important number;
- **activation → first real use** — did they log in and wire a host, or just
  install and stop?;
- **guide friction** — time-to-complete per guide, and which step generated
  support mail.

---

## 6. Timeline (30 days)

| Week | Cloud track | Local track | Gate |
|---|---|---|---|
| **0 — prep** | latency pass + install smoke + MCP test land in CI; workflow green on both arches | trial activation endpoint, trial license flow, cohort email | CI green, trial activation works end-to-end |
| **1** | watch p95 across the week on real cloud runners | 5 companies install on macOS + Linux | all 5 install, ≥1 guide bug found |
| **2** | arm64/x64 numbers both recorded | +15 companies; Windows shops in | no install failure on any OS; SLA p95 holds |
| **3** | MCP handshake green on all hosts | +10 to 30-cap; real loops running | 30-day conversion pipeline rehearsed on 1 company |
| **4** | final numbers frozen into `benchmark-summary.md` | 30-day reports in, guide fixes shipped | **go/no-go** |

**Go criteria:** install success ≥ 90% across OSes · brake p95 ≤ 1000ms on
cloud x64 + arm64 · redteam + thrift smokes green on 3 OSes · ≥ 25 of 30
companies actually used the tools (not just installed) · no unresolved
"tool broke my machine" class issue.

**No-go / slip criteria:** any of the above fails, or conversion mechanics
(closing a trial key into a paid variant) are not rehearsed — because
converting trial users on day one of release is the one thing a trial exists
to de-risk, and it must be proven before anyone is charged.

---

## 7. Reuse, not build

| Trial need | Existing machinery |
|---|---|
| Cohort source | waitlist table + deposit (`waitlist.ts`, `WAITLIST_DEPOSIT_CENTS`) |
| Trial license, 30-day | `/dev/activate` duration path + `lockIfExpired` timer |
| Connection limits | `connectionLimitFor` / devices.ts 402 on limit |
| Cloud numbers | `.github/workflows/throughput.yml` + `scripts/benchmark.mjs` |
| Guided setup | `guides.ts` gating (free first step, rest on license) |
| Usage evidence | audit logs: `brake status` / `redteam status` / `thrift report` |

---

## 8. Risks

- **Trial keys leak.** They are recognisable (`LYCEUM-DEV-…`), expire on a
  timer, and are rate-limited by connection counts — a leaked trial key is a
  low-value nuisance, not a revenue hole.
- **Cloud ≠ their cloud.** Our runners are not their VPC; we publish numbers
  as *our* cloud, and the local `thrift measure` exists precisely so every
  company can get *their* number on *their* machine.
- **Cohort goes quiet.** 30 days is long; 30 companies is small. The weekly
  structure (install → real loop → report) keeps a task in front of them, and
  the deposit already bought their attention.
- **Release slips.** That is the plan working. The month is cheap; a
  first-impression failure at GA is not.
