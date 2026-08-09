# Your AI agent is burning tokens re-reading things it already read

We kept seeing the same failure mode across agent harnesses we built and used: an agent calls `read_file` on the same file twice in one session — once early to orient itself, once later after it's "forgotten" — and pays full token price both times. Multiply that across a long agentic loop (search → read → edit → read again → test → read the test file again) and a meaningful fraction of the context window is spent re-transmitting content the model already has.

The fix isn't a bigger context window. It's not sending the duplicate in the first place.

## The three things actually worth doing

We built [`thrift`](https://github.com/Julie22-yaerin/Thelyceum_22/tree/main/packages/thrift), a compression layer that sits between a tool call and the agent, and it does exactly three things:

**Dedupe.** Hash every tool result by source. If the same source produces byte-identical content within a configurable call-age/token-age window, return a pointer instead of the content:

```
[thrift: unchanged since you read it earlier this session
(1,204 tokens, call #3, 2 calls ago). Content omitted because
you already have it. Say "re-read src/auth.ts in full" if you
need it again.]
```

The model can always ask for the full content back — nothing is silently dropped, it's deferred.

**Cap.** If a single result blows the token budget, slice it to a fragment with an explicit note telling the model it's a fragment and how to ask for more, instead of either truncating silently or blowing the budget.

**Strip.** Collapse runs of identical lines inside a single result (a build log with the same warning 400 times) before it ever reaches dedupe or cap.

None of this touches the model. It's pure string processing between the tool and the context window, which means it has to be fast enough that adding it is a non-decision — if it costs more latency than it saves in tokens, nobody should use it.

## The part we actually care about: does it know what it's touching

The easy version of this idea is "truncate anything over N tokens." That's also the version that will happily mangle a JWT or corrupt a diff. So before anything gets compressed, thrift classifies the content and treats "hard" tokens (things that lose meaning if altered — tokens, hashes, code structure) differently from "soft" tokens (prose, repeated boilerplate, verbose logs).

We test this explicitly, not just measure a global percentage:

```
thrift token-guard edge cases: JWT 0.0% saved ✓ held · image 97.8% ✓ · json 95.6% ✓
```

A JWT gets zero bytes touched — held, on purpose. A base64 image blob or a verbose JSON dump gets crushed by 95%+, because there's nothing in there an LLM needs verbatim. The interesting engineering isn't the compression ratio, it's the classifier deciding which bucket something falls into before a single byte moves.

## Numbers, from a public CI run, not a slide

We don't ship estimated savings — every number below is from [a live GitHub Actions run](https://github.com/Julie22-yaerin/Thelyceum_22/actions/workflows/throughput.yml) on this repo, re-measured on every commit, not a one-time benchmark cherry-picked for a launch post:

```
tool      p50        p95        p99        max        gate       status
thrift   20.41µs    56.42µs    70.24µs   533.33µs    10.00ms     PASS

thrift agent loop (12 files × 5 passes): 59.4% saved, 39.0% of it lossless
```

Two things worth pulling apart there. First, p95 latency to run the compressor is 56 microseconds — about 180x under its own 10ms CI gate, and small enough that it's noise next to any real network round-trip in an agent loop. Second, "39% of it lossless" matters more than the headline 59.4%: more than a third of the total savings on that run came purely from dedupe pointers — zero information loss, not a lossy trim. The rest is budget-capping on genuinely oversized results.

## Using it

If you're on LangChain.js, we published a wrapper that does this for any existing tool with no changes to the tool itself:

```ts
import { wrapTools } from "langchain-lyceum";

const tools = wrapTools([readFileTool, searchTool, runTestsTool]);
// pass `tools` to your agent exactly as before
```

It shares one dedupe ledger across every tool you wrap, so a file read via `read_file` and re-read via `grep_context` still dedupes against each other, not just against themselves.

The compression engine itself is MIT-licensed and framework-agnostic — it's also shipped as a CLI and an MCP server if you're not on LangChain: [github.com/Julie22-yaerin/Thelyceum_22](https://github.com/Julie22-yaerin/Thelyceum_22).

We'd genuinely like to hear where this classifier gets it wrong — the hard/soft split is the part most likely to have blind spots we haven't hit yet.
