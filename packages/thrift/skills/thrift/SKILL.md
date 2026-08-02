---
name: thrift
description: "Cut the tokens you burn on your own tool output. Use read_lean instead of the host's file read whenever you are working through a codebase, and run_lean instead of a raw shell tool for anything verbose — installs, test runs, builds, greps. Do this proactively, even if the user did not say /thrift, did not mention tokens or cost, and did not ask you to be efficient. The saving is largest when you re-read files while iterating: the second read of an unchanged file returns a pointer instead of the whole thing. Call thrift_report when the user asks what it saved."
---

# Thrift

Read and run through thrift so the tokens never enter the context in the first place.

## Why this exists

Nothing can shrink a conversation after the fact. The only tokens anyone can save are the ones that were never added — which means the saving has to happen at the moment a tool returns, not afterwards. That is what these tools are.

The largest single win is deduplication, and it only exists if you actually read through `read_lean`. The second time you open an unchanged file, it hands you a pointer instead of the content, because you already have it. That is free — nothing is lost.

## Triggers — use these without being asked

- **Reading any file while working through a codebase** → `read_lean` instead of the host's read. Especially on the second and third pass, which is where it pays.
- **Running anything with long output** → `run_lean`: `npm install`, `npm test`, builds, `grep -r`, `git log`, docker output.
- **You already have a huge blob in hand** — a pasted log, a long tool result → `compress_text` before reasoning over it.
- **The user asks about token cost, context usage, or what this saved** → `thrift_report`.

## Tools

- `read_lean` — read a file, deduplicated against this session. Pass `query` when hunting for something specific and it returns the relevant windows.
- `run_lean` — run a command, strip machine noise from its output.
- `compress_text` — compress text you already have.
- `thrift_report` — what was actually saved, from the ledger.

## What gets removed, and whether it is free

| Mechanism | What it does | Lossless? |
|---|---|---|
| dedupe | Content you already saw this session → a pointer | **Yes** |
| strip | ANSI codes, repeated log lines, base64 blobs, lockfile hashes | **Yes** |
| slice | A query selects the relevant windows of a large file | No — gaps are marked with line ranges |
| cap | Head+tail truncation at a token budget | No — announced in the payload |

Every reduction is announced in the result. When you see a `[thrift: …]` marker you are looking at a fragment, and it tells you how to get the rest.

## Don't

- **Do not treat a truncation marker as the whole file.** If a `[thrift: … omitted]` marker sits where the answer should be, ask for that range or raise `budget_tokens`. Guessing at content you were told was removed is worse than the tokens it saved.
- **Do not use `run_lean` for interactive commands.** It captures output; it cannot answer a prompt.
- **Do not claim a percentage.** The saving depends entirely on how much re-reading the work involves — on a first pass over unique files, deduplication does nothing. `thrift_report` has the real figure; use that instead of estimating.
- **Do not use `read_lean` when you need a byte-exact copy** — writing a file back out, or checksumming it. Read it normally for that.
