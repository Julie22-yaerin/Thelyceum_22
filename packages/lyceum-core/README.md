# lyceum_core — Rust state machine for context deduplication & budget tracking

The cloud side of The Lyceum: a Rust core that (1) **deduplicates repeated
context** so an agent re-reading the same file gets a pointer instead of the
payload, and (2) **tracks a session token budget** with `ok → warn → over`
states — the runaway-loop tripwire. On top of that sits the **Dual-Gate
(Trạm Gác 1 + Trạm Gác 2)** pipeline from the Red Team spec, so the same
core also strips context noise, blocks prompt injection, validates fact
anchors, auto-repairs broken JSON and kills semantic loops. Exposed to
Python through PyO3 with **zero copying of payload bytes** in either
direction.

This is the same logic that ships in the `thrift`/`brake`/`redteam` TypeScript
packages; the Rust core exists so the cloud service can run it at native
speed, inside Docker, with a hard memory bound (`HashMap` of 16-byte hashes,
never the content).

## Zero-copy contract

* **Input is borrowed.** `ContextGuard.process(source, content)` calls
  `Bound<PyStr>::to_str()`, which points into Python's own UTF-8 buffer.
  Hashing and token estimation run over those borrowed bytes — nothing is
  marshalled into a Rust-owned `String`.
* **Passthrough returns the same object.** When content isn't a repeat, the
  guard hands back the *identical* `Py<PyStr>` you passed in (a refcount
  bump). `demo()` asserts `r1.payload is content`.
* **The only allocation is the pointer string**, which is tiny and is the
  entire point of the call.
* **Budget state is two integers.** No copying at all.

## Dual-Gate architecture (Trạm Gác 1 + Trạm Gác 2)

```
[USER / AGENT] ──► 🛑 TRẠM 1: INPUT GATE ──► [LLM PROVIDER]
                    • strip noise / dedupe   (OpenAI/Anthropic)
                    • block prompt injection           │
                    • false-premise note               │
[USER / AGENT] ◄─── 🛑 TRẠM 2: OUTPUT GATE ◄───────────┘
                    • repair JSON / code
                    • mask hallucinated URLs
                    • kill semantic loops
```

**Trạm Gác 1 — Input Gatekeeper (`InputGate`, or `DualGate.ingress`)**

* *Luật 1* — Context Noise Stripping & Dedupe. ANSI escapes, blank runs and
  consecutive repeated log lines are cut; **hard data** (code fences, JSON
  schema, `$` limits, assignments) is never touched — lines inside code
  fences are fully protected. The cleaned bytes then go through the same
  `Deduplicator` as `ContextGuard`, so identical re-reads become pointer
  strings.
* *Luật 2* — False Premise Intercept. A deterministic deny-list blocks
  prompt injection (`ignore all previous instructions`, `reveal your system
  prompt`, …) — `action="block"` when strict, annotate otherwise. A cheap
  heuristic (factive frame + absolutist claim, short queries only) smells
  false premises and returns a **system note** that forces a fact-check.

**Trạm Gác 2 — Output Sanitizer (`OutputGate`, or `DualGate.egress`)**

* *Luật 3* — Fact-Anchor Validation. `seed_context(input)` registers the
  URLs/UUIDs/`$`-amounts that exist in the context; `egress(output)`
  token-pattern-matches the answer against them. Unknown URLs are masked to
  `[Unverified Link]` before the user sees them; every anchor is listed in
  `findings` for review.
* *Luật 4* — Deterministic Structural Enforcement. `JsonEnforcer` is a
  byte-level streaming JSON scanner (no regex, no SIMD dependency). When the
  model stops mid-object it appends the missing closers; it **refuses to
  fabricate** — an unterminated string or a missing value is reported, never
  guessed.
* *Luật 5* — Semantic Loop Detection. Shingle-Jaccard similarity + Shannon
  entropy over recent stream chunks; when the model starts repeating itself
  the gate says STOP and the caller keeps the best text so far.

See [`python/example_openai.py`](python/example_openai.py) —
`DualGateClient` wraps `openai.Client()` with the whole pipeline, and
`demo_dual_gate()` exercises all five laws offline.

## Build & run (local)

```bash
cd packages/lyceum-core
pip install maturin
maturin develop --release   # or: pip install -e .  (needs maturin backend)
python python/example_openai.py
```

## Using it

```python
from lyceum_core import ContextGuard

guard = ContextGuard(budget_tokens=100_000, warn_pct=0.8)

# 1. dedupe a file/tool read (lossless: content is already in context)
text = guard.process("src/license.py", file_contents).payload

# 2. gate an outbound model call
snap = guard.budget()
if snap.state == "over":
    raise RuntimeError(f"session over budget: {snap.used_tokens}/{snap.budget_tokens}")
```

For wrapping `openai.Client()`, see [`python/example_openai.py`](python/example_openai.py)
— `GuardedClient.read()` dedupes tool reads, `GuardedClient.chat()` gates spend.

## Docker (Linux production)

```bash
docker build -t lyceum-core .
docker run --rm lyceum-core    # runs the baked-in smoke test
docker buildx build --platform linux/amd64 -t lyceum-core .   # cross-arch
```

The image is multi-stage: a Rust builder compiles the wheel natively with
maturin (`manylinux_2_28`), and the runtime stage is a plain `python:3.11-slim`
with the wheel installed — no toolchain in production.

## API

| Python object | Purpose |
|---|---|
| `ContextGuard(budget_tokens, warn_pct, max_dedupe_age_calls, max_dedupe_age_tokens)` | combined session guard |
| `.process(source, content) → ProcessResult(action, payload, tokens_saved, snapshot)` | the hot path |
| `.spend(tokens) → snapshot` | count SDK-reported tokens |
| `.budget() → snapshot` | current state, no spend |
| `.reset()` | new session |
| `BudgetTrackerPy`, `DeduplicatorPy` | standalone state machines |
| `InputGate(strict, …)` | Trạm Gác 1: `.process(source, content) → InputGateResult`, `.classify(text)`, `.strip_noise(text)`, `.add_injection_pattern(p)` |
| `OutputGate(window_size, max_jaccard, min_entropy)` | Trạm Gác 2: `.seed_context(text)`, `.egress(output) → OutputScanResult`, `.feed_json(chunk)`, `.finish_json()`, `.feed_loop(chunk)` |
| `DualGate(budget_tokens, warn_pct, strict, …)` | both gates + shared budget: `.ingress`, `.seed_context`, `.egress`, `.feed_json`, `.finish_json`, `.feed_loop`, `.spend`, `.budget`, `.reset` |
| `JsonEnforcer` / `SemanticLoopDetector` | standalone Luật 4 / Luật 5 state machines |
| `estimate_tokens_py(text) → int` | one-shot heuristic count |

`InputGateResult(action, payload, removed_chars, removed_lines, anchors_kept,
injection, false_premise, note)` — `action` is `block|note|clean|passthrough|dedupe`.
`OutputScanResult.masked` is the output with unknown URLs replaced by
`[Unverified Link]`; `.findings` is `[AnchorFindingView(kind, value, known)]`.

`ProcessResult.snapshot` and `budget()` return
`BudgetSnapshotView(budget_tokens, used_tokens, remaining_tokens, calls, pct, state)`
where `remaining_tokens` is floored at zero and `state` is `ok|warn|over`.

## Semantics notes (why these exact rules)

* **Pointer expiry by calls AND tokens.** The host can compact context at any
  moment; a pointer that says "you already have it" when the copy has left the
  window is the one unrecoverable failure. `max_dedupe_age_calls` (default 20)
  and `max_dedupe_age_tokens` (default 40k) are two independent tripwires.
* **Never a pointer for changed content.** An edit mid-loop must always be
  re-sent in full — that's the entire value of a re-read.
* **A re-baselined sighting dedupes again immediately.** One expiry does not
  kill dedupe for the rest of the session.
* **Token estimate is a heuristic (±20%)** and is labelled as such; exactness
  is the server's job, cheap decisions are this core's.
