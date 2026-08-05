---
name: redteam
description: "Attack one-sided reasoning and dangerous code paths before they ship. Call challenge when the model is about to present a conclusion, recommend a plan, or write code — even if the user did not ask, did not type /redteam, or did not mention this skill at all. Use this proactively whenever reasoning sounds overconfident, cites authority without a source, skips trade-offs, or when code exhibits anti-patterns (code drift, null pointer risks, unhandled promises) or crash risks (guaranteed crashes, malicious commands). Provides WARNINGS with actionable advice without blocking execution, and BLOCKS only on deterministic crash paths or intentional exploits."
---

# Red Team

The adversarial rebuttal layer. One job: break one-sided reasoning and bad code paths before they ship.

## Triggers — call this even when the user did not ask

The model should call `challenge`, `rebut`, or `compact` itself when any of these match:

- **The model is about to present a conclusion as settled** — especially if favoring one side of a trade-off.
- **The user asks a question with more than one defensible answer**: "should we", "which is better", "is this right", "nên chọn", "cách nào tốt hơn", "có nên".
- **Code or architectural plans are being generated**: detect code drift, unhandled async risks, null pointer chains, or type unsafety early.
- **Context contains hesitation words or duplicate filler tokens**: use `compact` to clean the context cleanly without losing essential details.
- **The reasoning sounds overconfident**: obviously, clearly, certainly, definitely, guaranteed, chắc chắn, hiển nhiên.
- **An authority is cited with no source**: research shows, studies show, experts agree, it is well known, ai cũng biết.

## Tools

- `challenge` — scan a claim, plan, or piece of code for reasoning flaws and code risks. Issues `WARN` with advice for non-blocking code drift/anti-patterns, and `BLOCK` for deterministic crash/malicious paths.
- `rebut` — quick devil's advocate. Returns counter-arguments and verdict.
- `compact` — smart context compacting. Strips hesitation fillers (uh, um, ừm, à) and word duplications while strictly preserving technical context and logical structure.
- `redteam_status` — read recent challenge events from the audit log.

## How to use it

1. Draft the answer or code normally.
2. Filter hesitation noise with `compact` if processing messy input.
3. Run the proposed solution through `challenge`.
4. If warning flags come back (`action: "warn"`), review the provided advice and adjust code direction — execution is NOT blocked.
5. If the verdict is `blocked` (`action: "block"`), resolve the critical crash path or security issue before proceeding.

## Installation

```bash
redteam install claude-desktop   # MCP server, auto-loaded
redteam install claude-code      # PreToolUse hook on Write/Edit
redteam install chatgpt          # Skill file for ChatGPT Skills API
redteam install all              # all three
```
