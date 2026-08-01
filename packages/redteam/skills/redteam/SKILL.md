---
name: redteam
description: "Attack one-sided reasoning before it ships. Call challenge when the model is about to present a conclusion, recommend a plan, or answer a question with more than one side — even if the user did not ask, did not type /redteam, or did not mention this skill at all. Use this proactively whenever the reasoning sounds overconfident, cites authority without a source, considers only one side, forces a false dichotomy, skips trade-offs, quotes a straw man, leans on a single anecdote, or rests on an unverified assumption. The red team's job is to break the AI's own argument before it reaches the user — the user is shown the rebuttal, not asked to request one."
---

# Red Team

The adversarial rebuttal layer. One job: break one-sided reasoning before it ships.

## Triggers — call this even when the user did not ask

The model should call `challenge` and `rebut` itself when any of these match, even if the user did not invoke by name, did not type `/redteam`, or did not mention this skill:

- **The model is about to present a conclusion as settled** — especially if the conclusion favors one side of a real trade-off.
- **The user asks a question with more than one defensible answer**: "should we", "which is better", "is this right", "nên chọn", "cách nào tốt hơn", "có nên".
- **The reasoning sounds overconfident**: obviously, clearly, certainly, definitely, guaranteed, chắc chắn, hiển nhiên.
- **An authority is cited with no source**: research shows, studies show, experts agree, it is well known, ai cũng biết.
- **Only one side is counted**: no downside, no risks, perfect solution, nothing could go wrong, không có rủi ro.
- **A binary is forced**: the only option is, only two choices, lựa chọn duy nhất.
- **A recommendation has no stated trade-off**: the plan is, we should, i suggest, đề xuất.
- **The user is about to decide on a recommendation the model just made.**

## Tools

- `challenge` — scan a claim, plan, or piece of reasoning for red flags: overconfidence, unsupported_claim, confirmation_bias, false_dichotomy, missing_tradeoff, strawman, anecdote_as_evidence, slippery_slope, unchecked_assumption. Returns the flags, evidence, and steelman counter-questions. Call this BEFORE presenting a conclusion.
- `rebut` — quick devil's advocate. Returns only the counter-arguments and a verdict. Cheap; call it before answering any "which is better / should we" question.
- `redteam_status` — read the recent challenge events from the audit log.

## How to use it

1. Draft the answer normally.
2. Before presenting, run the conclusion through `challenge` — the claim, not the whole conversation.
3. If red flags come back, either fix the reasoning or present the counter-arguments to the user honestly. The verdict is the answer's other half: `challenge` exists so the user sees the debate, not just the conclusion.
4. When the verdict says `blocked`, the reasoning is one-sided — do not present it as settled. Revise, or present both sides and let the user decide.

## Authority

The red team is **unconditional in 'always' mode**. The model calls it on its own reasoning. The user is shown the rebuttal, not asked to request one. This is by design: an argument that no one attacked is an argument that was never tested.

## Don't

- Do not challenge routine, uncontroversial statements. False positives train the user to dismiss the rebuttal.
- Do not use the red team to fake even-handedness. The counter-arguments are real; if you cannot answer them, say so.
- Do not challenge for its own sake after the user already decided — challenge before presenting, not to relitigate.
- Do not hide the verdict. A challenged conclusion presented as certain is the exact mistake the red team exists to catch.

## Configuration

The red team is configured by `~/.redteam/config.json` and environment variables (`REDTEAM_AUDIT_PATH`, `REDTEAM_WEBHOOK_URL`, `REDTEAM_BLOCK_ON`). Read `redteam://rules` to see the watched patterns, and `redteam://mode` to check whether the model runs in 'always' or 'slash' mode.

## Install

```
redteam install claude-desktop   # MCP server, auto-loaded
redteam install claude-code      # PreToolUse hook on Write/Edit
redteam install chatgpt          # Skill file for ChatGPT Skills API
redteam install all              # all three
```

After `redteam install all`, the model challenges its own reasoning before presenting conclusions. The user does not have to type `/redteam` or mention this skill — the model calls it when the reasoning looks one-sided.
