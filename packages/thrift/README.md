# thrift

Cut the tokens an agent burns on its own tool output. CLI + MCP server + installable skill, same setup flow as [brake](../brake) and [redteam](../redteam).

> The saving depends entirely on your workload. This page gives measured numbers and the cases where thrift saves nothing — read the second table before you budget against the first.

---

## What it actually does

An MCP server cannot see your conversation. It cannot prune history, rewrite the system prompt, or intercept another server's results. Anything claiming to shrink your context by a fixed percentage from inside MCP is describing something it structurally cannot do.

What it *can* do is be the thing the model reads and runs **through**. When `read_lean` replaces the host's file read, the tokens that would have entered the context never do.

Four mechanisms, in the order they fire:

| | What it does | Lossless? |
|---|---|---|
| **dedupe** | Content already shown this session → a pointer | **Yes** — the model already has it |
| **strip** | ANSI codes, repeated log lines, standalone base64 blobs, lockfile hashes | **Yes** — removed bytes carry no meaning (a base64 run that is a segment of a dotted token like a JWT is a *fact* and is left intact) |
| **slice** | A query selects the relevant windows of a large file; windows snap to string/template/comment boundaries so a literal is never cut in half | No — gaps marked with line ranges |
| **cap** | Head+tail truncation at a token budget | No — announced as a FRAGMENT |

Every reduction is announced in the payload. A compressor that silently drops the one line the agent needed does not save money — it causes a retry that costs more than it saved, and nobody finds out why the agent got confused.

---

## Measured

On this repository (71 files, ~211k tokens), budget 4000:

| Scenario | Saved | Of which lossless |
|---|---|---|
| **Agent loop** — 12 files × 5 passes | **78.5%** | **97.6%** |
| Verbose tool output — npm logs, lockfile, test output | 91.4% | 14% |
| Targeted reads — query-sliced files >200 lines | 75.4% | — |
| **Fresh unique reads — every file once** | **50.4%** | **0%** |

> The agent-loop figure was measured before dedupe pointers gained an expiry
> window. Today a pointer is only handed out while the earlier read is still
> plausibly in context — within `THRIFT_DEDUPE_MAX_AGE` (default 20) tool calls
> and `THRIFT_DEDUPE_MAX_AGE_TOKENS` (default 40k) of new output. Past that,
> the full content is re-sent rather than claiming the model still has it. So
> the saving on YOUR loop depends on how quickly files are re-read: re-reads
> inside the window get the pointer, re-reads outside it pay full price — the
> honest price of never dangling a pointer that references evicted context.

Run it on your own files rather than trusting these:

```bash
thrift measure .              # what a first pass saves
thrift measure . --passes 5   # what an agent iterating saves
```

One expectation to set before you run `--passes 5`: on a repo larger than the
dedupe window, most re-reads are older than `THRIFT_DEDUPE_MAX_AGE` (20 calls)
so the pointer is refused and full content is re-sent — you will see a lower
saving than 78.5% and that is the product working as designed, not a bug. A
loop that re-reads a small working set quickly is where the pointer pays.

### Read that last row before you budget against the first

**On fresh unique reads, thrift's lossless saving is zero.** All 50.4% comes from truncating eight large files at the token budget — the model is told, but it saw less than the whole file. That is a real trade, not free money.

The honest summary:

- **Deduplication is where the free saving is**, and it only exists when the agent re-reads. In the agent-loop measurement, 97.6% of the saving was lossless.
- **Stripping is free but small** on source code — it fired on 3 of 71 files. It earns its place on logs and lockfiles, not on `.ts`.
- **Truncation is not compression.** It is a budget you chose. `thrift report` keeps the two apart for exactly this reason, and warns when most of a saving was truncation.

If your agent reads each file once and never returns to it, expect the strip figure and nothing more. If it iterates — which is what agents do — expect the loop figure.

---

## Install

```bash
npm install -g thrift
thrift install all          # claude-desktop + claude-code + chatgpt
```

Then restart the host. MCP tools load at session start, which is the step people skip before reporting that nothing happened.

Unlike brake, thrift installs **no PreToolUse hook**. brake is a gate and has to sit in front of every command; thrift is an *alternative* to the host's read and shell tools. A hook that intercepted every read to compress it would break byte-exact reads — writing a file back out, checksumming — with no way for the model to opt out. The model chooses `read_lean` when it pays and the normal read when it needs exact bytes.

---

## Use without an AI host

```bash
thrift measure .                      # what it would save on your files
thrift measure . --passes 5           # simulate an agent re-reading
thrift compress big.log --budget 2000
thrift compress - --query "auth flow" < server.ts
thrift tokens file.ts                 # estimate; --exact asks Anthropic
thrift report                         # what was actually saved, from the ledger
```

---

## Tools over MCP

| Tool | When the model should reach for it |
|---|---|
| `read_lean` | Reading any file while working through a codebase — especially the second and third pass |
| `run_lean` | Anything with long output: installs, tests, builds, greps |
| `compress_text` | A huge blob already in hand |
| `thrift_report` | The user asks what it saved |

---

## On the token numbers

Counts are a **heuristic**, labelled as such in every type, every report, and every CLI line. Anthropic's tokenizer is not published as a local library, and bundling a different model's tokenizer while calling its output "your token count" would be a confident number that is quietly wrong.

The heuristic weights by structural density — dense JSON fragments into more tokens per character than prose — and is calibrated to roughly ±15%. For a figure going in front of someone who will act on it:

```bash
thrift tokens file.ts --exact     # calls Anthropic's count_tokens
```

---

## Configuration

| Variable | Purpose |
|---|---|
| `THRIFT_BUDGET_TOKENS` | Default per-result cap. Default 4000. |
| `THRIFT_DEDUPE_MAX_AGE` | Max tool calls a dedupe pointer stays valid. Default 20. The host can compact context at any moment, so a pointer that references content which has since left the window is re-sent in full instead. |
| `THRIFT_DEDUPE_MAX_AGE_TOKENS` | Max new tokens emitted (across all thrift results) since a sighting while its pointer stays valid. Default 40000. A second, independent expiry — call count alone cannot see context pressure. |
| `THRIFT_HOME` | Where the ledger lives. Default `~/.thrift`. |
| `ANTHROPIC_API_KEY` | Only for `--exact` token counting. Nothing else reads it. |

---

## License

MIT. See [LICENSING.md](../../LICENSING.md) for the position on code protection.
