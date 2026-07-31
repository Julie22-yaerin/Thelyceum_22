---
scope: departments/qa_compliance
authority: absolute
---
# What counts as grounded

A claim is grounded only if it appears in the context retrieved for that
request. Paraphrase is allowed; invention is not.

Checked hardest, because these are the claims that cost money or trust:
- **Money**: any currency figure must match a figure in context exactly.
- **Percentages and metrics**: must appear in context.
- **Capability claims** ("we support X", "it integrates with Y").
- **Commitments** (dates, SLAs, guarantees).

Prose, reasoning, and hedged language are not fact-checked — flagging those
produces noise that trains operators to ignore the guard.
